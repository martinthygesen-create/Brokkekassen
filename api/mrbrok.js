const { getState, setState, uid, redactStateFor } = require('./_lib/store');
const { pickRandom } = require('./_lib/game');
const { pickTopic, beginMrbrokRound, advanceTurn } = require('./_lib/mrbrok');
const { pushToMembers } = require('./_lib/push');

const MIN_PLAYERS = 3;
const DEFAULT_ROUNDS = 4;
const ALLOWED_ROUNDS = [3, 4, 5];

// Point-fordeling for det personlige gætte-regnskab (ikke selve sejren, se
// endMrbrokGame): korrekt gæt fordobles pr. runde (1,2,4,8...), forkert
// gæt koster -1 — undtagen i SIDSTE runde, hvor det afgørende gæt vejer
// tungere: -2 ved forkert. MrBrok selv gætter aldrig (kender jo sig selv).
function resolveGuessPhase(state, players) {
  const m = state.mrbrok;
  const cur = m.current;
  const roundEntry = m.history.find(h => h.round === cur.round);
  if (roundEntry) roundEntry.guesses = { ...cur.guesses };

  const isFinal = cur.round >= m.totalRounds;
  const wrongPenalty = isFinal ? -2 : -1;
  const correctPoints = Math.pow(2, cur.round - 1);
  Object.entries(cur.guesses).forEach(([voterId, guessedId]) => {
    if (m.scores[voterId] === undefined) m.scores[voterId] = 0;
    m.scores[voterId] += (guessedId === m.mrBrokId) ? correctPoints : wrongPenalty;
  });

  if (!isFinal) {
    beginMrbrokRound(state, players);
    return;
  }

  // Sidste rundes gæt ER den officielle anklage: hvem flest pegede på.
  // Uafgjort tæller som fanget — tvivlen falder ikke MrBrok til gode.
  const tally = {};
  Object.values(cur.guesses).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
  const maxVotes = Math.max(0, ...Object.values(tally));
  const leaders = maxVotes > 0 ? Object.keys(tally).filter(id => tally[id] === maxVotes) : [];
  const caught = leaders.includes(m.mrBrokId);
  m.caught = caught;
  if (caught) {
    m.current = { type: 'steal', guess: null, votes: {} };
  } else {
    // Flertallet ramte forbi — MrBrok undslipper automatisk uden at skulle
    // gætte på emnet, og vinder.
    endMrbrokGame(state, true);
  }
}

// Flertal (blandt de andre spillere) afgør om MrBrok's gæt på emnet var
// tæt nok til at stjæle sejren. Uafgjort tæller som nej.
function resolveSteal(state) {
  const cur = state.mrbrok.current;
  const yes = Object.values(cur.votes).filter(v => v === true).length;
  const no = Object.values(cur.votes).filter(v => v === false).length;
  endMrbrokGame(state, yes > no);
}

function endMrbrokGame(state, mrBrokWon) {
  const m = state.mrbrok;
  if (m.wager === 'euro') {
    const payerIds = mrBrokWon ? m.players.filter(id => id !== m.mrBrokId) : [m.mrBrokId];
    payerIds.forEach(id => {
      state.events.push({ id: uid(), memberId: id, message: 'Tabte MrBrok', ts: Date.now(), votes: [], free: false, gameLoss: true });
    });
  }
  if (!state.mrbrokStats) state.mrbrokStats = {};
  m.players.forEach(id => {
    if (!state.mrbrokStats[id]) state.mrbrokStats[id] = { played: 0, wins: 0 };
    state.mrbrokStats[id].played += 1;
  });
  const winnerIds = mrBrokWon ? [m.mrBrokId] : m.players.filter(id => id !== m.mrBrokId);
  winnerIds.forEach(id => { state.mrbrokStats[id].wins += 1; });

  m.current = {
    type: 'gameover',
    mrBrokId: m.mrBrokId,
    topic: m.topic,
    caught: m.caught || false,
    mrBrokWon,
    scores: m.scores,
    history: m.history,
    stealGuess: m.current && m.current.guess,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { action, roomId, actorId } = req.body || {};
    if (!roomId || !actorId) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });
    if (!state.members.find(m => m.id === actorId)) return res.status(400).json({ error: 'ukendt medlem' });
    if (!state.mrbrok) state.mrbrok = { active: false };

    if (action === 'start') {
      if (state.mrbrok.active) return res.status(409).json({ error: 'MrBrok er allerede i gang' });
      if (state.game && state.game.active) return res.status(409).json({ error: 'Brokspillet er i gang — afslut det først' });
      const requested = Array.isArray(req.body.playerIds) ? req.body.playerIds : state.members.map(m => m.id);
      const playerObjs = state.members.filter(m => requested.includes(m.id));
      if (playerObjs.length < MIN_PLAYERS) return res.status(400).json({ error: `vælg mindst ${MIN_PLAYERS} spillere` });
      const wager = req.body.wager === 'euro' ? 'euro' : 'fun';
      const totalRounds = ALLOWED_ROUNDS.includes(req.body.totalRounds) ? req.body.totalRounds : DEFAULT_ROUNDS;
      const players = playerObjs.map(m => m.id);
      const mrBrokId = pickRandom(playerObjs).id;
      const scores = {};
      players.forEach(id => { if (id !== mrBrokId) scores[id] = 0; });

      state.mrbrok = {
        active: true, wager, players, mrBrokId, topic: pickTopic(state),
        round: 0, totalRounds, scores, caught: false, history: [], current: null, startedAt: Date.now(),
      };
      beginMrbrokRound(state, playerObjs);
      await setState(roomId, state);

      const starter = state.members.find(m => m.id === actorId);
      try {
        await pushToMembers(state, [actorId], {
          title: '🕵️ MrBrok er i gang!',
          body: `${starter ? starter.name : 'Nogen'} startede et spil — kom med!`,
          url: '/?r=' + roomId,
        });
      } catch (e) { /* push-fejl må ikke vælte selve spilstarten */ }

      return res.status(200).json({ state: redactStateFor(state, actorId) });
    }

    if (!state.mrbrok.active) return res.status(409).json({ error: 'der er ikke noget MrBrok-spil i gang' });
    const m = state.mrbrok;
    const cur = m.current;
    const players = m.players;

    if (action === 'submit') {
      const { payload } = req.body || {};
      if (!cur || !payload) return res.status(400).json({ error: 'mangler data' });
      if (!players.includes(actorId)) return res.status(403).json({ error: 'du er ikke med i dette spil af MrBrok' });

      if (cur.type === 'turn' && cur.phase === 'ask') {
        if (actorId !== cur.askerId) return res.status(403).json({ error: 'det er ikke din tur til at spørge' });
        const text = (payload.question || '').toString().trim().slice(0, 140);
        if (!text) return res.status(400).json({ error: 'skriv et spørgsmål' });
        cur.question = text;
        cur.phase = 'answer';
      } else if (cur.type === 'turn' && cur.phase === 'answer') {
        if (actorId !== cur.targetId) return res.status(403).json({ error: 'det er ikke dig der skal svare lige nu' });
        const text = (payload.answer || '').toString().trim().slice(0, 140);
        if (!text) return res.status(400).json({ error: 'skriv et svar' });
        cur.answer = text;
        advanceTurn(state);
      } else if (cur.type === 'guess') {
        if (actorId === m.mrBrokId) return res.status(403).json({ error: 'du kan ikke gætte på dig selv' });
        if (!players.includes(payload.guessedId)) return res.status(400).json({ error: 'ukendt spiller' });
        cur.guesses[actorId] = payload.guessedId;
        if (Object.keys(cur.guesses).length >= players.length - 1) resolveGuessPhase(state, state.members.filter(mm => players.includes(mm.id)));
      } else if (cur.type === 'steal' && !cur.guess) {
        if (actorId !== m.mrBrokId) return res.status(403).json({ error: 'kun MrBrok kan gætte emnet' });
        const text = (payload.guess || '').toString().trim().slice(0, 140);
        if (!text) return res.status(400).json({ error: 'skriv dit gæt' });
        cur.guess = text;
      } else if (cur.type === 'steal' && cur.guess) {
        if (actorId === m.mrBrokId) return res.status(403).json({ error: 'du kan ikke stemme om dit eget gæt' });
        cur.votes[actorId] = !!payload.closeEnough;
        if (Object.keys(cur.votes).length >= players.length - 1) resolveSteal(state);
      } else {
        return res.status(400).json({ error: 'ugyldig handling lige nu' });
      }
      await setState(roomId, state);
      return res.status(200).json({ state: redactStateFor(state, actorId) });
    }

    // "advance" er nødbremsen klientens nedtællings-timer bruger hvis nogen
    // ikke når at svare/gætte/stemme til tiden — spring bare videre.
    if (action === 'advance') {
      if (!cur) return res.status(400).json({ error: 'ingen aktiv runde' });

      if (cur.type === 'turn' && cur.phase === 'ask') {
        cur.question = cur.question || '(intet spørgsmål — tiden løb ud)';
        advanceTurn(state);
      } else if (cur.type === 'turn' && cur.phase === 'answer') {
        cur.answer = cur.answer || '(intet svar — tiden løb ud)';
        advanceTurn(state);
      } else if (cur.type === 'guess') {
        resolveGuessPhase(state, state.members.filter(mm => players.includes(mm.id)));
      } else if (cur.type === 'steal' && !cur.guess) {
        endMrbrokGame(state, false);
      } else if (cur.type === 'steal' && cur.guess) {
        resolveSteal(state);
      } else {
        return res.status(400).json({ error: 'kan ikke gå videre lige nu' });
      }
      await setState(roomId, state);
      return res.status(200).json({ state: redactStateFor(state, actorId) });
    }

    if (action === 'end') {
      state.mrbrok = { active: false };
      await setState(roomId, state);
      return res.status(200).json({ state: redactStateFor(state, actorId) });
    }

    return res.status(400).json({ error: 'ukendt handling' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
