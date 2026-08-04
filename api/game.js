const { getState, setState, uid } = require('./_lib/store');
const { beginRound } = require('./_lib/game');
const { pushToMembers } = require('./_lib/push');

const DEFAULT_ROUNDS = 8;
const ALLOWED_ROUNDS = [5, 8, 12];
const ROUND_POINTS = 2;

function resolveQuiplashVote(state, cur) {
  const tally = {};
  Object.values(cur.votes).forEach(id => (tally[id] = (tally[id] || 0) + 1));
  const maxVotes = Math.max(0, ...Object.values(tally));
  const winnerIds = maxVotes > 0 ? Object.keys(tally).filter(id => tally[id] === maxVotes) : [];
  winnerIds.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + ROUND_POINTS; });
  cur.phase = 'results';
  cur.winnerIds = winnerIds;
  cur.readyIds = [];
}

// Point-fordeling: hver spiller der gætter RIGTIGT får 2 point. Forfatteren
// får til gengæld 1 point for hver spiller de FORVIRREDE (gættede forkert)
// — så forfatteren reelt konkurrerer mod gætterne om den samme pulje af
// point i stedet for en alt-eller-intet-bonus.
function resolveTrueFalseGuess(state, cur) {
  const correctGuessers = Object.keys(cur.guesses).filter(id => cur.guesses[id] === cur.isTrue);
  const fooledGuessers = Object.keys(cur.guesses).filter(id => cur.guesses[id] !== cur.isTrue);
  correctGuessers.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + ROUND_POINTS; });
  if (state.game.scores[cur.authorId] !== undefined && fooledGuessers.length) {
    state.game.scores[cur.authorId] += fooledGuessers.length;
  }
  cur.phase = 'results';
  cur.correctGuessers = correctGuessers;
  cur.fooledCount = fooledGuessers.length;
  cur.readyIds = [];
}

function resolveTriviaAnswer(state, cur) {
  const correctGuessers = Object.keys(cur.choices).filter(id => cur.choices[id] === cur.correctIndex);
  correctGuessers.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + ROUND_POINTS; });
  cur.phase = 'results';
  cur.correctGuessers = correctGuessers;
  cur.readyIds = [];
}

function goToNextRoundOrEnd(state, players) {
  if (state.game.round >= state.game.totalRounds) endGame(state);
  else beginRound(state, state.members.filter(m => players.includes(m.id)));
}

function endGame(state) {
  const scores = state.game.scores;
  const memberIds = state.game.players;
  const minScore = Math.min(...memberIds.map(id => scores[id] || 0));
  const maxScore = Math.max(...memberIds.map(id => scores[id] || 0));
  const loserIds = memberIds.filter(id => (scores[id] || 0) === minScore);
  const winnerIds = memberIds.filter(id => (scores[id] || 0) === maxScore);
  if (state.game.wager === 'euro') {
    loserIds.forEach(id => {
      state.events.push({ id: uid(), memberId: id, message: 'Tabte Brokspillet', ts: Date.now(), votes: [], free: false, gameLoss: true });
    });
  }

  // Highscore på tværs af afsluttede spil — kun optalt hvis der reelt var en
  // vinder (dvs. ikke alle sluttede på 0 point, hvilket ville gøre alle til "vindere").
  if (!state.gameStats) state.gameStats = {};
  memberIds.forEach(id => {
    if (!state.gameStats[id]) state.gameStats[id] = { played: 0, wins: 0 };
    state.gameStats[id].played += 1;
  });
  if (maxScore > 0) {
    winnerIds.forEach(id => { state.gameStats[id].wins += 1; });
  }

  state.game.current = { type: 'gameover', scores, loserIds, winnerIds };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { action, roomId, actorId } = req.body || {};
    if (!roomId || !actorId) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });
    if (!state.members.find(m => m.id === actorId)) return res.status(400).json({ error: 'ukendt medlem' });
    if (!state.game) state.game = { active: false };

    if (action === 'start') {
      if (state.game.active) return res.status(409).json({ error: 'spillet er allerede i gang' });
      const requested = Array.isArray(req.body.playerIds) ? req.body.playerIds : state.members.map(m => m.id);
      const players = state.members.map(m => m.id).filter(id => requested.includes(id));
      if (players.length < 2) return res.status(400).json({ error: 'vælg mindst 2 spillere' });
      const wager = req.body.wager === 'euro' ? 'euro' : 'fun';
      const totalRounds = ALLOWED_ROUNDS.includes(req.body.totalRounds) ? req.body.totalRounds : DEFAULT_ROUNDS;
      const scores = {};
      players.forEach(id => (scores[id] = 0));
      state.game = { active: true, wager, players, round: 0, totalRounds, scores, current: null, startedAt: Date.now() };
      beginRound(state, state.members.filter(m => players.includes(m.id)));
      await setState(roomId, state);

      const starter = state.members.find(m => m.id === actorId);
      try {
        await pushToMembers(state, [actorId], {
          title: '🎲 Brokspillet er i gang!',
          body: `${starter ? starter.name : 'Nogen'} startede et spil — kom med!`,
          url: '/?r=' + roomId,
        });
      } catch (e) { /* push-fejl må ikke vælte selve spilstarten */ }

      return res.status(200).json({ state });
    }

    if (!state.game.active) return res.status(409).json({ error: 'der er ikke noget spil i gang' });
    const cur = state.game.current;
    const players = state.game.players || state.members.map(m => m.id);

    if (action === 'submit') {
      const { payload } = req.body || {};
      if (!cur || !payload) return res.status(400).json({ error: 'mangler data' });
      if (!players.includes(actorId)) return res.status(403).json({ error: 'du er ikke med i denne runde af Brokspillet' });

      if (cur.type === 'quiplash' && cur.phase === 'answer') {
        const text = (payload.text || '').toString().trim().slice(0, 120);
        if (text) cur.answers[actorId] = text;
        if (Object.keys(cur.answers).length >= players.length) { cur.phase = 'vote'; cur.votes = {}; }
      } else if (cur.type === 'quiplash' && cur.phase === 'vote') {
        if (payload.votedFor && payload.votedFor !== actorId) cur.votes[actorId] = payload.votedFor;
        if (Object.keys(cur.votes).length >= players.length) resolveQuiplashVote(state, cur);
      } else if (cur.type === 'truefalse' && cur.phase === 'write') {
        if (actorId !== cur.authorId) return res.status(403).json({ error: 'kun den der skriver rundens udsagn kan gøre dette' });
        const targetId = payload.targetId && players.includes(payload.targetId) ? payload.targetId : cur.authorId;
        const statement = (payload.statement || '').toString().trim().slice(0, 120);
        if (!statement) return res.status(400).json({ error: 'skriv et udsagn' });
        cur.targetId = targetId;
        cur.statement = statement;
        cur.isTrue = !!payload.isTrue;
        cur.phase = 'guess';
        // Gemmes til senere spil — content skal ikke gå til spilde.
        if (!state.gameContentBank) state.gameContentBank = { truefalse: [] };
        if (!state.gameContentBank.truefalse) state.gameContentBank.truefalse = [];
        state.gameContentBank.truefalse.push({ authorId: cur.authorId, targetId, statement, isTrue: cur.isTrue, ts: Date.now() });
        if (state.gameContentBank.truefalse.length > 60) state.gameContentBank.truefalse.shift();
      } else if (cur.type === 'truefalse' && cur.phase === 'guess') {
        if (actorId === cur.authorId) return res.status(403).json({ error: 'du kan ikke gætte på dit eget udsagn' });
        cur.guesses[actorId] = !!payload.guess;
        if (Object.keys(cur.guesses).length >= players.length - 1) resolveTrueFalseGuess(state, cur);
      } else if (cur.type === 'trivia' && cur.phase === 'answer') {
        if (Number.isInteger(payload.choiceIndex)) cur.choices[actorId] = payload.choiceIndex;
        if (Object.keys(cur.choices).length >= players.length) resolveTriviaAnswer(state, cur);
      } else {
        return res.status(400).json({ error: 'ugyldig handling lige nu' });
      }
      await setState(roomId, state);
      return res.status(200).json({ state });
    }

    // "ready" er spillerens EGET valg om at gå videre — bruges i resultat-
    // pausen mellem runder, hvor der ikke er noget at indsende. Runden går
    // først videre når alle er klar (eller når nedtællingen løber ud, se
    // 'advance' herunder som stadig er den fælles nødbremse).
    if (action === 'ready') {
      if (!cur || cur.phase !== 'results') return res.status(400).json({ error: 'kan ikke gøres klar lige nu' });
      if (!players.includes(actorId)) return res.status(403).json({ error: 'du er ikke med i denne runde af Brokspillet' });
      if (!cur.readyIds) cur.readyIds = [];
      if (!cur.readyIds.includes(actorId)) cur.readyIds.push(actorId);
      if (cur.readyIds.length >= players.length) goToNextRoundOrEnd(state, players);
      await setState(roomId, state);
      return res.status(200).json({ state });
    }

    // "advance" er nu kun nødbremsen som klientens nedtællings-timer bruger
    // hvis nogen ikke når at svare/blive klar til tiden — ikke længere en
    // knap nogen trykker for at afbryde de andre.
    if (action === 'advance') {
      if (!cur) return res.status(400).json({ error: 'ingen aktiv runde' });

      if (cur.type === 'quiplash' && cur.phase === 'answer') {
        cur.phase = 'vote';
        cur.votes = {};
      } else if (cur.type === 'quiplash' && cur.phase === 'vote') {
        resolveQuiplashVote(state, cur);
      } else if (cur.type === 'truefalse' && cur.phase === 'guess') {
        resolveTrueFalseGuess(state, cur);
      } else if (cur.type === 'trivia' && cur.phase === 'answer') {
        resolveTriviaAnswer(state, cur);
      } else if (cur.phase === 'results') {
        goToNextRoundOrEnd(state, players);
      } else {
        return res.status(400).json({ error: 'kan ikke gå videre lige nu' });
      }
      await setState(roomId, state);
      return res.status(200).json({ state });
    }

    if (action === 'end') {
      state.game = { active: false };
      await setState(roomId, state);
      return res.status(200).json({ state });
    }

    return res.status(400).json({ error: 'ukendt handling' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
