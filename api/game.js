const { getState, setState, uid } = require('./_lib/store');
const { beginRound } = require('./_lib/game');

const TOTAL_ROUNDS = 5;
const ROUND_POINTS = 2;

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
      const scores = {};
      players.forEach(id => (scores[id] = 0));
      state.game = { active: true, wager, players, round: 0, totalRounds: TOTAL_ROUNDS, scores, current: null };
      beginRound(state, state.members.filter(m => players.includes(m.id)));
      await setState(roomId, state);
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
      } else if (cur.type === 'quiplash' && cur.phase === 'vote') {
        if (payload.votedFor && payload.votedFor !== actorId) cur.votes[actorId] = payload.votedFor;
      } else if (cur.type === 'truefalse' && cur.phase === 'write') {
        if (actorId !== cur.authorId) return res.status(403).json({ error: 'kun den der skriver rundens udsagn kan gøre dette' });
        const targetId = payload.targetId && players.includes(payload.targetId) ? payload.targetId : cur.authorId;
        const statement = (payload.statement || '').toString().trim().slice(0, 120);
        if (!statement) return res.status(400).json({ error: 'skriv et udsagn' });
        cur.targetId = targetId;
        cur.statement = statement;
        cur.isTrue = !!payload.isTrue;
        cur.phase = 'guess';
      } else if (cur.type === 'truefalse' && cur.phase === 'guess') {
        if (actorId === cur.authorId) return res.status(403).json({ error: 'du kan ikke gætte på dit eget udsagn' });
        cur.guesses[actorId] = !!payload.guess;
      } else if (cur.type === 'trivia' && cur.phase === 'answer') {
        if (Number.isInteger(payload.choiceIndex)) cur.choices[actorId] = payload.choiceIndex;
      } else {
        return res.status(400).json({ error: 'ugyldig handling lige nu' });
      }
      await setState(roomId, state);
      return res.status(200).json({ state });
    }

    if (action === 'advance') {
      if (!cur) return res.status(400).json({ error: 'ingen aktiv runde' });

      if (cur.type === 'quiplash' && cur.phase === 'answer') {
        cur.phase = 'vote';
        cur.votes = {};
      } else if (cur.type === 'quiplash' && cur.phase === 'vote') {
        const tally = {};
        Object.values(cur.votes).forEach(id => (tally[id] = (tally[id] || 0) + 1));
        const maxVotes = Math.max(0, ...Object.values(tally));
        const winnerIds = maxVotes > 0 ? Object.keys(tally).filter(id => tally[id] === maxVotes) : [];
        winnerIds.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + ROUND_POINTS; });
        cur.phase = 'results';
        cur.winnerIds = winnerIds;
      } else if (cur.type === 'truefalse' && cur.phase === 'guess') {
        const correctGuessers = Object.keys(cur.guesses).filter(id => cur.guesses[id] === cur.isTrue);
        correctGuessers.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + ROUND_POINTS; });
        const guessCount = Object.keys(cur.guesses).length;
        if (guessCount > 0 && correctGuessers.length === 0) {
          state.game.scores[cur.authorId] = (state.game.scores[cur.authorId] || 0) + ROUND_POINTS;
        }
        cur.phase = 'results';
        cur.correctGuessers = correctGuessers;
      } else if (cur.type === 'trivia' && cur.phase === 'answer') {
        const correctGuessers = Object.keys(cur.choices).filter(id => cur.choices[id] === cur.correctIndex);
        correctGuessers.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + ROUND_POINTS; });
        cur.phase = 'results';
        cur.correctGuessers = correctGuessers;
      } else if (cur.phase === 'results') {
        if (state.game.round >= state.game.totalRounds) {
          endGame(state);
        } else {
          beginRound(state, state.members.filter(m => players.includes(m.id)));
        }
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
