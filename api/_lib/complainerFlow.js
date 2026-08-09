// Runde-flow til Det Store Brokkeri ("The Big Complainer") — samme opdeling som
// MrBrok's mrbrok.js/mrbrokFlow.js og Brokspillets game.js/gameFlow.js:
// _lib/complainer.js holder rent INDHOLD (arketyper, situationer, prompts),
// denne fil holder selve SPIL-FLOWET (opbygningsrunder, mistankeafstemning,
// bank/gamble-mekanikken, den private afsløring, gættefinalen) og
// tids-nødbremsen. Ligger under _lib/ så den IKKE tæller med i Vercels
// 12-serverless-function-loft.
//
// Egen, uafhængig state-gren (state.complainer) og eget flow — rører ALDRIG
// state.mrbrok/state.game eller deres flow-filer. Se CLAUDE.md.

const { uid } = require('./store');
const { pickRandom, shuffle } = require('./game');
const { assignArchetypesAndSituations, pickPromptFor } = require('./complainer');
// Genbruger de delte tids-konstanter og "phase stamp"-hjælperen fra
// Brokspillets gameFlow.js (samme mønster MrBrok allerede gør) — importerer
// kun herfra, rører ALDRIG selve filen eller dens spil-specifikke logik.
const { stampPhase, MIN_COMPLAIN_AGE_MS, BROKSPILLET_AUTO_MS, COMPLAINT_COUNTDOWN_MS } = require('./gameFlow');

// Point for at være DENNE rundes topmest mistænkte — sikkert at give, fordi
// ingen (heller ikke Den Store Brokker selv) endnu ved hvem der reelt er
// skyldig på dette tidspunkt i spillet; det er ren performance/cheap-talk.
// "safe" banker med det samme; "gamble" sætter beløbet i spil på om samme
// spiller OGSÅ topper mistanken NÆSTE runde (dobbelt op / helt tabt). Tabet
// er et tabt IKKE-bankede point, aldrig en negativ saldo — man kan derfor
// aldrig komme i minus af denne mekanik (se pendingGamble-håndteringen
// nedenfor), men gevinsten/tabet er stort nok (dobbelt op) til at det rent
// faktisk stikker, ikke bare er ligegyldigt baggrundsstøj.
const SUSPECT_POINTS = 2;

function stampPhaseComplainer(cur) {
  cur.phaseStartedAt = Date.now();
  cur.complaint = null;
  return cur;
}

// Starter en helt ny opbygningsrunde: nye, eskalerende prompts til alle
// stadig deltagende spillere (matchet til deres situation), OG en ny
// tur-rækkefølge — broksene siges HØJT ved bordet, én spiller ad gangen,
// nøjagtig samme mønster som MrBrok's clue-fase (se beginClueRound i
// mrbrokFlow.js) og bevidst IKKE samtidig indtastning. Der er intet
// tekstfelt og intet der gemmes af selve broksens ORDLYD — kun HVEM der har
// sagt sit brok (turnIndex), aldrig HVAD de sagde. Det er en bevidst
// designbeslutning (produktejer-rettelse): gættefinalen skal hvile på
// spillernes egen hukommelse om hvad der blev sagt ved bordet, ikke på en
// app-gemt facitliste — se submitGuess længere nede.
function beginComplainRound(state, roundNumber) {
  const c = state.complainer;
  c.round = roundNumber;
  const prompts = {};
  c.players.forEach(id => {
    const prompt = pickPromptFor(id, c.situations[id], roundNumber, c.totalRounds, c.usedPromptIds[id] || []);
    prompts[id] = { id: prompt.id, text: prompt.text, category: prompt.category, tier: prompt.tier };
    if (!c.usedPromptIds[id]) c.usedPromptIds[id] = [];
    c.usedPromptIds[id].push(prompt.id);
  });
  const order = shuffle(c.players);
  c.current = { type: 'complain', round: roundNumber, order, turnIndex: 0, speakerId: order[0], prompts };
  stampPhaseComplainer(c.current);
}

// Den aktuelle taler har markeret deres tur som ovre (sagt deres brok højt —
// intet tekstfelt, kun en bekræftelse). Går videre til næste taler i
// rækkefølgen, eller (når hele runden er igennem) den hemmelige
// mistankeafstemning. Samme struktur som MrBrok's advanceClue.
function advanceComplain(state) {
  const c = state.complainer;
  const cur = c.current;
  const next = cur.turnIndex + 1;
  if (next < cur.order.length) {
    c.current = { type: 'complain', round: cur.round, order: cur.order, turnIndex: next, speakerId: cur.order[next], prompts: cur.prompts };
    stampPhaseComplainer(c.current);
  } else {
    beginVoteRound(state);
  }
}

// Alle har sagt deres brok højt — arkivér kun HVILKEN prompt hver spiller
// fik (til reference/genkaldelse), ALDRIG selve broksens ordlyd (den findes
// kun i den fysiske samtale ved bordet, se beginComplainRound), og gå
// videre til hemmelig mistankeafstemning.
function beginVoteRound(state) {
  const c = state.complainer;
  const cur = c.current;
  if (!c.history) c.history = [];
  c.history.push({ round: cur.round, prompts: cur.prompts });
  c.current = { type: 'vote', round: cur.round, votes: {} };
  stampPhaseComplainer(c.current);
}

// Alle har stemt hemmeligt — tæl op, kår rundens topmest mistænkte, afregn
// en evt. ventende satsning fra forrige runde, og tilbyd den nye topmest
// mistænkte valget mellem bank/gamble.
function resolveSuspicionRound(state) {
  const c = state.complainer;
  const cur = c.current; // type: vote
  const tally = {};
  Object.values(cur.votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
  const maxVotes = Math.max(0, ...Object.values(tally));
  const leaders = maxVotes > 0 ? Object.keys(tally).filter(id => tally[id] === maxVotes) : c.players.slice();
  const topId = leaders[Math.floor(Math.random() * leaders.length)];
  const tie = leaders.length > 1;
  // BEVIDST ingen tally her — c.topSuspectHistory er ALDRIG redigeret væk
  // (se redactComplainerFor), så en fuld stemmefordeling gemt her ville
  // lække til alle med det samme og gøre "Udfordring"s hele pointe
  // (at tallyen NORMALT er skjult, og kun afsløres hvis nogen udfordrer)
  // meningsløs. Selve tallyen lever kun transient på cur.tally nedenfor,
  // som ER redigeret betinget af cur.challenged.
  c.topSuspectHistory.push({ round: cur.round, topId, tie });

  // Afregn en evt. ventende satsning FRA FORRIGE runde: vandt kun hvis
  // SAMME spiller også topper mistanken denne runde.
  let lastGambleResult = null;
  if (c.pendingGamble) {
    const g = c.pendingGamble;
    if (g.playerId === topId) {
      const win = g.amount * 2;
      c.scores[g.playerId] = (c.scores[g.playerId] || 0) + win;
      lastGambleResult = { playerId: g.playerId, won: true, amount: win };
    } else {
      // Tabt satsning = et tabt point der ALDRIG blev banket — ingen
      // negativ saldo, blot ingen gevinst. Se kommentar ved SUSPECT_POINTS.
      lastGambleResult = { playerId: g.playerId, won: false, amount: g.amount };
    }
    c.pendingGamble = null;
  }
  c.lastGambleResult = lastGambleResult;

  // tally gemmes altid på selve bet-fasen (ikke kun i topSuspectHistory
  // bagefter) så en "Udfordring" (se applyComplainerChallenge nedenfor,
  // EXPERIMENTEL) kan afsløre den for alle MENS runden stadig er aktiv —
  // men den er redigeret væk for almindelige klienter indtil den evt.
  // udfordres, se redactComplainerFor i _lib/complainer.js.
  c.current = { type: 'bet', round: cur.round, topId, tie, choice: null, tally, stakeMultiplier: 1, challenged: false, challengedBy: null };
  stampPhaseComplainer(c.current);
}

// ============================================================
// EXPERIMENTAL — "Udfordring" (Coup/Blood on the Clocktower-inspireret
// engangs-mekanik). Se CLAUDE.md/commit-besked for produktejer-kontekst.
// Bevidst holdt i sit eget lille, letgenkendelige blok med ét
// call-site-flag (state.complainer.challengeEnabled) — hvis dette IKKE
// tester godt ved bordet, kan hele blokken (denne funktion + dens ene
// kaldested i api/complainer.js's 'challenge'-handler + UI-knappen i
// index.html's complainerBetHtml) fjernes i ét hug uden at røre resten af
// runde-flowet. Rører BEVIDST ALDRIG beginReveal/afsløringstidspunktet,
// rundeantallet, eller noget andet uden for selve DENNE bet-runde.
function applyComplainerChallenge(state, actorId) {
  const c = state.complainer;
  const cur = c.current; // type: bet
  cur.challenged = true;
  cur.challengedBy = actorId;
  cur.stakeMultiplier = 2;
  if (!c.challengeUsedBy) c.challengeUsedBy = {};
  c.challengeUsedBy[actorId] = true;
}
// ============================================================

// Den topmest mistænkte har valgt hvordan de vil "banke" rundens point —
// eller nødbremsen har valgt 'safe' for dem. Går videre til enten næste
// opbygningsrunde eller (efter den sidste konfigurerede runde) den private
// afsløring + gættefinalen.
//
// DOMMEBESLUTNING (dokumenteret her fordi det er et judgment call, se
// opgavebeskrivelsen): den organiske afsløring udløses simpelt og konkret —
// lige efter DEN SIDSTE konfigurerede opbygningsrundes bank/gamble-valg er
// afgjort. Ingen skjult ekstra-runde eller "nok distinkte prompts"-tæller —
// runde-antallet ER allerede host-konfigureret til at ramme den rigtige
// mængde opbygget materiale (3-6 runder), så det er det simpleste, mest
// forudsigelige konkrete udløser-punkt: værten ved præcis hvornår
// afsløringen kommer, uden at det er et fast rundetal spilleren selv kan
// tælle sig frem til fra spillets START (som var problemet i MrBrok-sessionen
// der motiverede dette spil, jf. CLAUDE.md).
function resolveBet(state) {
  const c = state.complainer;
  const cur = c.current; // type: bet
  // stakeMultiplier er normalt 1 — kun EXPERIMENTAL "Udfordring" sætter den
  // til 2 (se applyComplainerChallenge ovenfor). Rører intet andet ved
  // point-mekanikken.
  const stake = SUSPECT_POINTS * (cur.stakeMultiplier || 1);
  if (cur.choice === 'gamble') {
    c.pendingGamble = { playerId: cur.topId, amount: stake, round: cur.round };
  } else {
    c.scores[cur.topId] = (c.scores[cur.topId] || 0) + stake;
  }
  if (cur.round >= c.totalRounds) {
    beginReveal(state);
  } else {
    beginComplainRound(state, cur.round + 1);
  }
}

// Den private afsløring: Den Store Brokker får FØRST HER at vide hvem de er
// — ikke ved spilstart. Selve "hemmeligheden" (c.guiltyId) er sat allerede
// ved spilstart, men holdes ude af klienten (se redactComplainerFor i
// api/complainer.js) indtil netop dette øjeblik. api/complainer.js sender en
// PRIVAT push til kun c.guiltyId når denne fase starter — ingen broadcast.
function beginReveal(state) {
  const c = state.complainer;
  c.revealed = true;
  c.revealedAt = Date.now();
  c.current = { type: 'guess', targetId: null, detail: null };
  stampPhaseComplainer(c.current);
}

// Den Store Brokker gætter — STADIG I KARAKTER — en konkret detalje om en
// navngiven medspiller ud fra hvad de har sagt i opbygningsrunderne. Dette
// hviler UDELUKKENDE på spillernes egen hukommelse fra bordet (broksene blev
// sagt højt, aldrig gemt som tekst, se beginComplainRound) — akkurat som
// MrBrok's eget tyveri-gæt (resolveSteal i mrbrokFlow.js) allerede virker
// fra hukommelse uden nogen app-facitliste. Ikke et hul der mangler at blive
// lukket, men en bevidst del af konceptet.
function submitGuess(state, targetId, detail) {
  const c = state.complainer;
  c.current.targetId = targetId;
  c.current.detail = detail;
  c.current.type = 'judge';
  c.current.votes = {};
  stampPhaseComplainer(c.current);
}

// De andre stemmer hemmeligt "tæt nok" — simpelt flertal afgør, ingen
// algoritmisk facit-tjek (menneskeligt skøn, jf. opgavebeskrivelsen).
function resolveJudge(state) {
  const c = state.complainer;
  const cur = c.current; // type: judge
  const yes = Object.values(cur.votes).filter(v => v === true).length;
  const no = Object.values(cur.votes).filter(v => v === false).length;
  endComplainerGame(state, yes > no);
}

function endComplainerGame(state, guiltyWon) {
  const c = state.complainer;
  if (c.wager === 'euro') {
    const payerIds = guiltyWon ? c.players.filter(id => id !== c.guiltyId) : [c.guiltyId];
    payerIds.forEach(id => {
      state.events.push({ id: uid(), memberId: id, message: 'Tabte Det Store Brokkeri', ts: Date.now(), votes: [], free: false, gameLoss: true });
    });
  }
  if (!state.complainerStats) state.complainerStats = {};
  const realPlayerIds = c.players.filter(id => !(state.members.find(x => x.id === id) || {}).isBot);
  realPlayerIds.forEach(id => {
    if (!state.complainerStats[id]) state.complainerStats[id] = { played: 0, wins: 0 };
    state.complainerStats[id].played += 1;
  });
  const winnerIds = guiltyWon ? [c.guiltyId] : c.players.filter(id => id !== c.guiltyId);
  winnerIds.filter(id => realPlayerIds.includes(id)).forEach(id => { state.complainerStats[id].wins += 1; });

  c.current = {
    type: 'gameover',
    guiltyId: c.guiltyId,
    guiltyWon,
    targetId: c.current.targetId,
    detail: c.current.detail,
    votes: c.current.votes,
    scores: c.scores,
    topSuspectHistory: c.topSuspectHistory,
  };
}

// Hvem mangler stadig at gøre noget for at den aktuelle fase kan gå videre?
// Samme rolle som Brokspillets/MrBrok's getPendingIds.
function getPendingComplainerIds(c) {
  const cur = c.current;
  if (!cur) return [];
  if (cur.type === 'complain') return [cur.speakerId];
  if (cur.type === 'vote') return c.players.filter(id => cur.votes[id] === undefined);
  if (cur.type === 'bet') return cur.choice ? [] : [cur.topId];
  if (cur.type === 'guess') return cur.targetId ? [] : [c.guiltyId];
  if (cur.type === 'judge') return c.players.filter(id => id !== c.guiltyId && cur.votes[id] === undefined);
  return [];
}

// Tvinger den aktuelle fase videre fordi en brok-nedtælling løb ud uden at
// den langsomme nåede det — samme filosofi som Brokspillet/MrBrok: intet
// stille spring, kun et synligt brok (menneske eller "Det Store Brokkeri selv")
// efterfulgt af en udløbet nedtælling må rykke fasen videre.
function forceResolveComplainerPhase(state) {
  const c = state.complainer;
  const cur = c.current;
  const pending = getPendingComplainerIds(c);
  if (cur.type === 'complain') {
    advanceComplain(state);
  } else if (cur.type === 'vote') {
    pending.forEach(id => {
      const others = c.players.filter(p => p !== id);
      cur.votes[id] = others.length ? pickRandom(others) : id;
    });
    resolveSuspicionRound(state);
  } else if (cur.type === 'bet') {
    cur.choice = 'safe';
    resolveBet(state);
  } else if (cur.type === 'guess') {
    const others = c.players.filter(p => p !== c.guiltyId);
    submitGuess(state, others.length ? pickRandom(others) : c.guiltyId, '(nåede ikke at gætte)');
  } else if (cur.type === 'judge') {
    pending.forEach(id => { cur.votes[id] = false; });
    resolveJudge(state);
  }
}

// Den ENESTE ting der har lov til at rykke Det Store Brokkeri videre pga. tid —
// kaldes opportunistisk fra enhver poll/handling, aldrig af klientens eget ur.
function expireComplainerPhaseIfDue(state) {
  const c = state.complainer;
  const cur = c && c.current;
  if (!c || !c.active || !cur || !cur.phaseStartedAt) return false;
  const pending = getPendingComplainerIds(c);
  if (pending.length === 0) return false;
  const now = Date.now();
  if (!cur.complaint) {
    if (now - cur.phaseStartedAt < BROKSPILLET_AUTO_MS) return false;
    cur.complaint = { by: 'brokkefaelden', targetId: pending[0], startedAt: now };
    return true;
  }
  if (now - cur.complaint.startedAt < COMPLAINT_COUNTDOWN_MS) return false;
  forceResolveComplainerPhase(state);
  return true;
}

module.exports = {
  SUSPECT_POINTS,
  MIN_COMPLAIN_AGE_MS,
  BROKSPILLET_AUTO_MS,
  COMPLAINT_COUNTDOWN_MS,
  assignArchetypesAndSituations,
  beginComplainRound,
  advanceComplain,
  beginVoteRound,
  resolveSuspicionRound,
  resolveBet,
  applyComplainerChallenge, // EXPERIMENTAL — se kommentaren ved funktionen
  beginReveal,
  submitGuess,
  resolveJudge,
  endComplainerGame,
  getPendingComplainerIds,
  expireComplainerPhaseIfDue,
};
