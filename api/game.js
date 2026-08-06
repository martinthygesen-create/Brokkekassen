const { mutateState, uid, redactStateFor, ApiError } = require('./_lib/store');
const { beginRound, buildOptions, pickDecoyBroks } = require('./_lib/game');
const { pushToMembers } = require('./_lib/push');

const DEFAULT_ROUNDS = 8;
const ALLOWED_ROUNDS = [5, 8, 12];
const ROUND_POINTS = 2;

// Nominelle fase-varigheder — skal matche GAME_PHASE_SECONDS i index.html.
// Bruges KUN server-side til at afvise en for tidlig 'advance'-nødbremse
// (se stampPhase/'advance'-handleren nedenfor); klientens egen nedtælling
// er stadig det brugeren faktisk ser.
const PHASE_SECONDS = {
  'quiplash:answer': 60, 'quiplash:vote': 35,
  'truefalse:write': 60, 'truefalse:guess': 35,
  'trivia:answer': 35,
  'guessbrok:write': 60, 'guessbrok:guess': 35,
  'results': 20, 'skipped': 20,
};
// Sætter et tidsstempel på den fase der lige er startet, så 'advance' kan
// afvise et kald der IKKE reelt svarer til en udløbet nedtælling — uden
// dette kunne en forældet klient-timer (fra FØR en anden spiller allerede
// rykkede runden videre) nå at ramme den helt nye fase i det korte vindue
// før klienten selv opdager skiftet via poll, og springe den over et
// øjeblik efter den startede.
function stampPhase(cur) {
  cur.phaseStartedAt = Date.now();
  return cur;
}

// Ved uafgjort stemning (2+ svar med samme antal stemmer) afgør "Chancen"
// det i stedet for at dele sejren mellem alle tied kandidater — gælder
// uanset antal spillere, ikke kun 2-spiller-tilfældet. cur.chanceCandidates
// holder styr på HVEM der reelt var i spil for den tilfældige udvælgelse,
// så klienten kan vise en reel med præcis de kandidater (fx kun de 2 der
// var lige om det ud af 4 spillere), ikke alle der svarede.
function resolveQuiplashVote(state, cur) {
  const tally = {};
  Object.values(cur.votes).forEach(id => (tally[id] = (tally[id] || 0) + 1));
  const maxVotes = Math.max(0, ...Object.values(tally));
  const tiedIds = maxVotes > 0 ? Object.keys(tally).filter(id => tally[id] === maxVotes) : [];
  cur.phase = 'results';
  stampPhase(cur);
  cur.readyIds = [];
  if (tiedIds.length > 1) {
    const winnerId = tiedIds[Math.floor(Math.random() * tiedIds.length)];
    state.game.scores[winnerId] = (state.game.scores[winnerId] || 0) + ROUND_POINTS;
    cur.winnerIds = [winnerId];
    cur.randomPick = true;
    cur.chanceCandidates = tiedIds;
  } else {
    tiedIds.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + ROUND_POINTS; });
    cur.winnerIds = tiedIds;
  }
}

// Med kun 2 spillere giver afstemning ingen mening — den ENESTE mulige
// stemme er på modpartens svar, så begge stemmer på den anden og det
// bliver en tvungen uafgjort hver eneste gang (og lader man dem stemme på
// sig selv i stedet, stemmer begge rationelt på sig selv, samme uafgjorte
// resultat). Løsningen er at springe afstemningen helt over ved præcis 2
// spillere og i stedet lade "Chancen" kåre en vinder direkte.
function resolveQuiplashRandom(state, cur) {
  const ids = Object.keys(cur.answers || {});
  const winnerId = ids.length ? ids[Math.floor(Math.random() * ids.length)] : null;
  const winnerIds = winnerId ? [winnerId] : [];
  winnerIds.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + ROUND_POINTS; });
  cur.phase = 'results';
  stampPhase(cur);
  cur.winnerIds = winnerIds;
  cur.readyIds = [];
  cur.votes = {};
  cur.randomPick = true;
  cur.chanceCandidates = ids;
}

// Point-fordeling: gæt rigtigt = 1 point. Narrer forfatteren FLERTALLET af
// gætterne = 1 point til forfatteren. Simpelt og loftbelagt, så det ikke kan
// løbe løbsk hvis man narrer alle på én gang.
function resolveTrueFalseGuess(state, cur) {
  const correctGuessers = Object.keys(cur.guesses).filter(id => cur.guesses[id] === cur.isTrue);
  const fooledGuessers = Object.keys(cur.guesses).filter(id => cur.guesses[id] !== cur.isTrue);
  const totalGuessers = correctGuessers.length + fooledGuessers.length;
  correctGuessers.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + 1; });
  const authorWon = totalGuessers > 0 && fooledGuessers.length > totalGuessers / 2;
  if (authorWon && state.game.scores[cur.authorId] !== undefined) {
    state.game.scores[cur.authorId] += 1;
  }
  cur.phase = 'results';
  stampPhase(cur);
  cur.correctGuessers = correctGuessers;
  cur.authorWon = authorWon;
  cur.readyIds = [];
}

// Point-fordeling for "Hvilket brok ville {author} sige?": gæt rigtigt
// (find forfatterens ægte brok blandt de opdigtede) = 1 point. Hvis INGEN
// finder det ægte, får forfatteren en bonus for at have skrevet et
// overbevisende opdigtet-agtigt rigtigt brok.
function resolveGuessBrok(state, cur) {
  const correctGuessers = Object.keys(cur.guesses).filter(id => cur.guesses[id] === cur.correctIndex);
  const totalGuessers = Object.keys(cur.guesses).length;
  correctGuessers.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + 1; });
  const authorWon = totalGuessers > 0 && correctGuessers.length === 0;
  if (authorWon && state.game.scores[cur.authorId] !== undefined) {
    state.game.scores[cur.authorId] += 1;
  }
  cur.phase = 'results';
  stampPhase(cur);
  cur.correctGuessers = correctGuessers;
  cur.authorWon = authorWon;
  cur.readyIds = [];
}

function resolveTriviaAnswer(state, cur) {
  const correctGuessers = Object.keys(cur.choices).filter(id => cur.choices[id] === cur.correctIndex);
  correctGuessers.forEach(id => { state.game.scores[id] = (state.game.scores[id] || 0) + ROUND_POINTS; });
  cur.phase = 'results';
  stampPhase(cur);
  cur.correctGuessers = correctGuessers;
  cur.readyIds = [];
}

function goToNextRoundOrEnd(state, players) {
  if (state.game.round >= state.game.totalRounds) endGame(state);
  else { beginRound(state, state.members.filter(m => players.includes(m.id))); stampPhase(state.game.current); }
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

    // Al læsning+mutation+skrivning sker inde i mutateState, som automatisk
    // prøver igen mod frisk data hvis en anden spiller nåede at skrive
    // først (fx alle der stemmer i samme sekund) — ellers ville den sidste
    // skrivning stille overskrive den forrige, og en spillers svar kunne gå
    // helt tabt uden nogen fejl at se.
    let pushInfo = null;
    const mutated = await mutateState(roomId, async (state) => {
      if (!state.members.find(m => m.id === actorId)) throw new ApiError(400, 'ukendt medlem');
      if (!state.game) state.game = { active: false };

      if (action === 'start') {
        if (state.game.active) throw new ApiError(409, 'spillet er allerede i gang');
        if (state.mrbrok && state.mrbrok.active) throw new ApiError(409, 'MrBrok er i gang — afslut det først');
        const requested = Array.isArray(req.body.playerIds) ? req.body.playerIds : state.members.map(m => m.id);
        const players = state.members.map(m => m.id).filter(id => requested.includes(id));
        if (players.length < 2) throw new ApiError(400, 'vælg mindst 2 spillere');
        const wager = req.body.wager === 'euro' ? 'euro' : 'fun';
        const totalRounds = ALLOWED_ROUNDS.includes(req.body.totalRounds) ? req.body.totalRounds : DEFAULT_ROUNDS;
        const scores = {};
        players.forEach(id => (scores[id] = 0));
        state.game = { active: true, wager, players, round: 0, totalRounds, scores, current: null, startedAt: Date.now() };
        beginRound(state, state.members.filter(m => players.includes(m.id)));
        stampPhase(state.game.current);
        const starter = state.members.find(m => m.id === actorId);
        pushInfo = { excludeIds: [actorId], title: '🎲 Brokspillet er i gang!', body: `${starter ? starter.name : 'Nogen'} startede et spil — kom med!`, url: '/?r=' + roomId };
        return;
      }

      if (!state.game.active) throw new ApiError(409, 'der er ikke noget spil i gang');
      const cur = state.game.current;
      const players = state.game.players || state.members.map(m => m.id);

      if (action === 'submit') {
        const { payload } = req.body || {};
        if (!cur || !payload) throw new ApiError(400, 'mangler data');
        if (!players.includes(actorId)) throw new ApiError(403, 'du er ikke med i denne runde af Brokspillet');

        if (cur.type === 'quiplash' && cur.phase === 'answer') {
          const text = (payload.text || '').toString().trim().slice(0, 120);
          if (text) cur.answers[actorId] = text;
          if (Object.keys(cur.answers).length >= players.length) {
            if (players.length === 2) resolveQuiplashRandom(state, cur);
            else { cur.phase = 'vote'; cur.votes = {}; stampPhase(cur); }
          }
        } else if (cur.type === 'quiplash' && cur.phase === 'vote') {
          if (payload.votedFor && payload.votedFor !== actorId) cur.votes[actorId] = payload.votedFor;
          if (Object.keys(cur.votes).length >= players.length) resolveQuiplashVote(state, cur);
        } else if (cur.type === 'truefalse' && cur.phase === 'write') {
          if (actorId !== cur.authorId) throw new ApiError(403, 'kun den der skriver rundens udsagn kan gøre dette');
          const targetId = payload.targetId && players.includes(payload.targetId) ? payload.targetId : cur.authorId;
          const statement = (payload.statement || '').toString().trim().slice(0, 120);
          if (!statement) throw new ApiError(400, 'skriv et udsagn');
          cur.targetId = targetId;
          cur.statement = statement;
          cur.isTrue = !!payload.isTrue;
          cur.phase = 'guess';
          stampPhase(cur);
          // Gemmes til senere spil — content skal ikke gå til spilde.
          if (!state.gameContentBank) state.gameContentBank = { truefalse: [] };
          if (!state.gameContentBank.truefalse) state.gameContentBank.truefalse = [];
          state.gameContentBank.truefalse.push({ authorId: cur.authorId, targetId, statement, isTrue: cur.isTrue, ts: Date.now() });
          if (state.gameContentBank.truefalse.length > 60) state.gameContentBank.truefalse.shift();
        } else if (cur.type === 'truefalse' && cur.phase === 'guess') {
          if (cur.authorId && actorId === cur.authorId) throw new ApiError(403, 'du kan ikke gætte på dit eget udsagn');
          cur.guesses[actorId] = !!payload.guess;
          // Ved et "verdens-brok"-udsagn (isWorld) er der ingen forfatter der
          // sidder over — ALLE spillere gætter, så tærsklen er players.length
          // i stedet for players.length - 1.
          const eligible = cur.authorId ? players.length - 1 : players.length;
          if (Object.keys(cur.guesses).length >= eligible) resolveTrueFalseGuess(state, cur);
        } else if (cur.type === 'trivia' && cur.phase === 'answer') {
          if (Number.isInteger(payload.choiceIndex)) cur.choices[actorId] = payload.choiceIndex;
          if (Object.keys(cur.choices).length >= players.length) resolveTriviaAnswer(state, cur);
        } else if (cur.type === 'guessbrok' && cur.phase === 'write') {
          if (actorId !== cur.authorId) throw new ApiError(403, 'kun den der skriver rundens brok kan gøre dette');
          const statement = (payload.statement || '').toString().trim().slice(0, 120);
          if (!statement) throw new ApiError(400, 'skriv et brok');
          const decoys = pickDecoyBroks(state, 3);
          const { options, correctIndex } = buildOptions(statement, decoys);
          cur.statement = statement;
          cur.options = options;
          cur.correctIndex = correctIndex;
          cur.phase = 'guess';
          cur.guesses = {};
          stampPhase(cur);
        } else if (cur.type === 'guessbrok' && cur.phase === 'guess') {
          if (actorId === cur.authorId) throw new ApiError(403, 'du kan ikke gætte på dit eget brok');
          if (Number.isInteger(payload.choiceIndex)) cur.guesses[actorId] = payload.choiceIndex;
          if (Object.keys(cur.guesses).length >= players.length - 1) resolveGuessBrok(state, cur);
        } else {
          throw new ApiError(400, 'ugyldig handling lige nu');
        }
        return;
      }

      // "ready" er spillerens EGET valg om at gå videre — bruges i resultat-
      // pausen mellem runder, hvor der ikke er noget at indsende. Runden går
      // først videre når alle er klar (eller når nedtællingen løber ud, se
      // 'advance' herunder som stadig er den fælles nødbremse).
      if (action === 'ready') {
        if (!cur || (cur.phase !== 'results' && cur.phase !== 'skipped')) throw new ApiError(400, 'kan ikke gøres klar lige nu');
        if (!players.includes(actorId)) throw new ApiError(403, 'du er ikke med i denne runde af Brokspillet');
        if (!cur.readyIds) cur.readyIds = [];
        if (!cur.readyIds.includes(actorId)) cur.readyIds.push(actorId);
        if (cur.readyIds.length >= players.length) goToNextRoundOrEnd(state, players);
        return;
      }

      // "advance" er nu kun nødbremsen som klientens nedtællings-timer bruger
      // hvis nogen ikke når at svare/blive klar til tiden — ikke længere en
      // knap nogen trykker for at afbryde de andre.
      if (action === 'advance') {
        if (!cur) throw new ApiError(400, 'ingen aktiv runde');
        // Afvis en 'advance' der IKKE reelt svarer til en udløbet nedtælling
        // for den fase spillet rent faktisk er i lige nu — en klients timer
        // kan nå at "løbe ud" og sende dette kald i det korte vindue mellem
        // at en ANDEN spiller allerede har rykket runden videre og at denne
        // klient selv opdager det via næste poll. Uden dette tjek kunne det
        // springe en helt frisk fase over et øjeblik efter den startede.
        // Selve racet er kun bredt nok til klientens poll-interval (3s) plus
        // lidt margen — det behøver IKKE være halvdelen af fasens fulde
        // varighed, det ville bare gøre nødbremsen unødigt langsom til at
        // reagere på en ægte udløbet nedtælling.
        const phaseKey = (cur.phase === 'results' || cur.phase === 'skipped') ? cur.phase : (cur.type + ':' + cur.phase);
        const MIN_PHASE_AGE_MS = 5000;
        if (PHASE_SECONDS[phaseKey] && cur.phaseStartedAt && (Date.now() - cur.phaseStartedAt) < MIN_PHASE_AGE_MS) {
          return;
        }

        if (cur.type === 'quiplash' && cur.phase === 'answer') {
          cur.votes = {};
          if (players.length === 2) {
            // Ved præcis 2 spillere stemmes der aldrig — se resolveQuiplashRandom.
            resolveQuiplashRandom(state, cur);
          } else if (Object.keys(cur.answers).length < 2) {
            // For få nåede at svare inden tiden løb ud — der er intet
            // meningsfyldt at stemme om (hver spiller ville se "ingen andre
            // svar at stemme på"), så spring stemme-fasen over og gå direkte
            // til et resultat uden vinder i stedet for at gå i stå der.
            resolveQuiplashVote(state, cur);
          } else {
            cur.phase = 'vote';
            stampPhase(cur);
          }
        } else if (cur.type === 'quiplash' && cur.phase === 'vote') {
          resolveQuiplashVote(state, cur);
        } else if (cur.type === 'truefalse' && cur.phase === 'write') {
          // Forfatteren nåede aldrig at skrive et udsagn inden tiden løb ud
          // — der er intet at gætte på, så runden springes over. Vis det
          // tydeligt i stedet for bare stille at hoppe videre (dette var
          // tidligere slet ikke håndteret her, så en tavs forfatter låste
          // hele spillet fast uden nogen besked om hvorfor).
          cur.phase = 'skipped';
          cur.readyIds = [];
          stampPhase(cur);
        } else if (cur.type === 'truefalse' && cur.phase === 'guess') {
          resolveTrueFalseGuess(state, cur);
        } else if (cur.type === 'trivia' && cur.phase === 'answer') {
          resolveTriviaAnswer(state, cur);
        } else if (cur.type === 'guessbrok' && cur.phase === 'write') {
          // Samme mønster som sandt/falsk: forfatteren nåede aldrig at
          // skrive et brok — spring runden over i stedet for at hænge.
          cur.phase = 'skipped';
          cur.readyIds = [];
          stampPhase(cur);
        } else if (cur.type === 'guessbrok' && cur.phase === 'guess') {
          resolveGuessBrok(state, cur);
        } else if (cur.phase === 'results' || cur.phase === 'skipped') {
          goToNextRoundOrEnd(state, players);
        } else {
          throw new ApiError(400, 'kan ikke gå videre lige nu');
        }
        return;
      }

      if (action === 'end') {
        state.game = { active: false };
        return;
      }

      throw new ApiError(400, 'ukendt handling');
    });
    if (!mutated) return res.status(404).json({ error: 'ukendt brokkekasse' });
    const { state } = mutated;

    if (pushInfo) {
      try { await pushToMembers(state, pushInfo.excludeIds, { title: pushInfo.title, body: pushInfo.body, url: pushInfo.url }); }
      catch (e) { /* push-fejl må ikke vælte selve handlingen */ }
    }

    return res.status(200).json({ state: redactStateFor(state, actorId) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
