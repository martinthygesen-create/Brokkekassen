// Ren spillogik til MrBrok — ingen state-adgang her udover ren
// datamanipulation, ingen scoring/euro/stats (det ligger i api/mrbrok.js,
// ligesom Brokspillets endGame() ligger i api/game.js og ikke her). Ligger
// under _lib/ så den IKKE tæller med i Vercels 12-serverless-function-loft.

const { shuffle, pickFromBag } = require('./game');

// Brede brok-scenarier — bevidst ikke for specifikke, så både MrBrok kan
// bluffe plausibelt OG de der reelt kender emnet skal svare vagt for ikke
// at afsløre for meget. Genbruger samme shuffle-bag-rotation som resten af
// indholdet, så de ikke gentages før hele puljen er brugt.
const MRBROK_TOPICS = [
  'En nabo der altid larmer for meget',
  'En kollega der aldrig tager sin del af opvasken på arbejdet',
  'Et familiemedlem der altid kommer for sent',
  'En håndværker der aldrig dukker op til tiden',
  'En restaurant med alt for langsom betjening',
  'En ven der aldrig betaler sin del tilbage',
  'Et flyselskab der mistede bagagen',
  'En teenager der aldrig rydder op efter sig selv',
  'En chef der altid tager æren for andres arbejde',
  'Et supermarked der hele tiden er løbet tør for det du skal bruge',
  'En taxachauffør der kører den lange vej',
  'En eksmakker der stadig ringer alt for tit',
  'Et hotelværelse med udsigt til en mur',
  'En sælger der ikke vil tage nej for et svar',
  'Naboens hund der gør hele natten',
  'En fest hvor musikken aldrig stopper',
  'En internetudbyder der ikke kan finde ud af at reparere fejl',
  'En bilmekaniker der opfinder problemer der ikke findes',
  'Et fly der er forsinket i timevis uden forklaring',
  'En kollega der altid tager æren i møder',
];

function pickTopic(state) {
  const idx = pickFromBag(state, 'mrbrokTopic', MRBROK_TOPICS.length);
  return MRBROK_TOPICS[idx];
}

// Bygger en runde-parring: hver spiller spørger præcis én gang og bliver
// spurgt præcis én gang, ingen spørger sig selv, og (bedste forsøg) ingen
// gentager sidste rundes parring. Kræver mindst 3 spillere.
function buildRoundPairing(players, prevPairing) {
  const ids = players.map(p => p.id);
  const prevKey = prevPairing ? prevPairing.map(p => p.askerId + '>' + p.targetId).sort().join('|') : null;
  let targets, attempts = 0;
  do {
    targets = shuffle(ids);
    attempts++;
  } while (
    (targets.some((t, i) => t === ids[i]) ||
      (prevKey && ids.map((askerId, i) => askerId + '>' + targets[i]).sort().join('|') === prevKey)) &&
    attempts < 50
  );
  return ids.map((askerId, i) => ({ askerId, targetId: targets[i] }));
}

function beginMrbrokRound(state, players) {
  state.mrbrok.round += 1;
  const prevPairing = state.mrbrok.current && state.mrbrok.current.pairing;
  const pairing = buildRoundPairing(players, prevPairing);
  state.mrbrok.current = {
    type: 'turn',
    round: state.mrbrok.round,
    pairing,
    turnIndex: 0,
    askerId: pairing[0].askerId,
    targetId: pairing[0].targetId,
    phase: 'ask',
    question: null,
    answer: null,
  };
}

// Afslutter den aktuelle tur (spørgsmål+svar er på plads, eller sprunget
// over pga. timeout), lægger den i rundens historik, og går videre til
// næste tur — eller til gættefasen hvis det var rundens sidste tur.
function advanceTurn(state) {
  const cur = state.mrbrok.current;
  if (!state.mrbrok.history) state.mrbrok.history = [];
  let roundEntry = state.mrbrok.history.find(h => h.round === cur.round);
  if (!roundEntry) {
    roundEntry = { round: cur.round, turns: [], guesses: {} };
    state.mrbrok.history.push(roundEntry);
  }
  roundEntry.turns.push({ askerId: cur.askerId, targetId: cur.targetId, question: cur.question, answer: cur.answer });

  const next = cur.turnIndex + 1;
  if (next < cur.pairing.length) {
    const p = cur.pairing[next];
    state.mrbrok.current = {
      type: 'turn', round: cur.round, pairing: cur.pairing, turnIndex: next,
      askerId: p.askerId, targetId: p.targetId, phase: 'ask', question: null, answer: null,
    };
  } else {
    state.mrbrok.current = { type: 'guess', round: cur.round, guesses: {} };
  }
}

module.exports = { MRBROK_TOPICS, pickTopic, buildRoundPairing, beginMrbrokRound, advanceTurn };
