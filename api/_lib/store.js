const { redis } = require('./redis');

// Normaliseret til små bogstaver, så det ikke betyder noget om telefonens
// tastatur autokapitaliserede første bogstav i koden (fx "Skygge-ophy").
const KEY = (roomId) => `brokkekassen:room:${(roomId || '').toString().trim().toLowerCase()}`;

// Den der opretter en brokkekasse er dens admin: den første, der nogensinde
// joiner rummet, bliver stående som members[0] og er dermed admin for altid.
function isAdmin(state, memberId) {
  return !!(state && state.members[0] && state.members[0].id === memberId);
}

const RESET_HOUR = 4; // ny runde starter kl 04 lokal tid
const RESET_TZ = 'Europe/Copenhagen';

function emptyState() {
  return {
    createdAt: Date.now(), // brokkekassens fødselsdag — rykkes ALDRIG efter oprettelse
    dayBoundary: Date.now(), // starten af "i dag", til streaks/lodtrækning og "Dagens BigSpender"
    members: [],   // {id, name}
    events: [],    // {id, memberId, message, ts, votes:[voterIds], free} — vokser bare, tømmes kun ved manuel "Gør op"
    pendingList: [], // [{id, memberId, message, votes:[voterIds], openedAt, need}] — flere kan være i gang samtidig
    history: [],   // {startedAt, closedAt, total, totals:{memberId:amt}, events:[...]} — kun fra manuel "Gør op"/lukning
    freeBrokMemberId: null, // dagens heldige vinder af gratis brok, trukket tilfældigt
    freeBrokDrawnAt: null,  // tidsstempel for seneste lodtrækning, til at vise animationen præcis én gang pr. trækning
    streaks: {},   // memberId -> antal sammenhængende dage uden brok
    closed: false, // hele brokkekassen er lukket permanent (ingen flere brok)
    pushSubs: {},  // memberId -> PushSubscription, til rigtige push-notifikationer
    goal: '',      // fri tekst sat af admin: hvad potten går til, fx "Fælles middag"
    acquittals: [], // {id, memberId, message, openedAt, expiredAt} — anklager der udløb uden nok stemmer
    lastSilenceNudgeAt: null, // sidste gang alle fik en "her er stille" push, til at undgå at spamme
    lastMilestoneAt: 0, // højeste rundetal (10, 20, 30...) puljen allerede er fejret ved
    game: { active: false }, // Brokspillet — se api/game.js + api/_lib/game.js
    gameStats: {}, // memberId -> {played, wins} — highscore på tværs af afsluttede Brokspil-runder
    // Sat én gang ved oprettelse — Brokkekassen og Brokspillet er ligestillede
    // valg, man kan vælge begge eller kun ét. Styrer kun hvad der vises.
    kasseEnabled: true,
    gameEnabled: true,
  };
}

const PENDING_REMINDER_AFTER = 12 * 3600000; // push-reminder til dem der mangler at stemme
const PENDING_EXPIRE_AFTER = 24 * 3600000;   // herefter frikendes anklagen automatisk

// Tjekker ventende anklager for påmindelse/udløb. Kaldes fra state.js (som
// alle klienter poller hvert 3. sek, mens appen er åben) — ingen rigtig cron
// nødvendig. Returnerer hvem der skal have en reminder-push nu; selve
// push-afsendelsen sker udenfor store.js, som ikke kender til push.js.
function processPendingExpiry(state) {
  const now = Date.now();
  const dueReminders = [];
  if (!state.acquittals) state.acquittals = [];
  state.pendingList = state.pendingList.filter(p => {
    const age = now - p.openedAt;
    if (age >= PENDING_EXPIRE_AFTER) {
      state.acquittals.push({ id: p.id, memberId: p.memberId, message: p.message, openedAt: p.openedAt, expiredAt: now });
      return false;
    }
    if (age >= PENDING_REMINDER_AFTER && !p.reminded) {
      p.reminded = true;
      const memberIds = state.members.map(m => m.id).filter(id => id !== p.memberId && !p.votes.includes(id));
      if (memberIds.length) dueReminders.push({ pending: p, memberIds });
    }
    return true;
  });
  return dueReminders;
}

const SILENCE_NUDGE_AFTER = 24 * 3600000; // så længe stilhed før vi drilsk minder om at boksen findes
const QUIET_HOURS_START = 21; // ingen push efter kl. 21...
const QUIET_HOURS_END = 8;    // ...før kl. 08 lokal tid

// Aktuel lokal time i Copenhagen (0-23), til at holde push ude af nattetimer.
function copenhagenLocalHour(ts) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: RESET_TZ, hourCycle: 'h23', hour: '2-digit' });
  return parseInt(dtf.format(new Date(ts)), 10);
}

// Har der været fuldstændig stille (ingen brok) i over 24 timer? Returnerer
// true højst én gang per stille-periode — sender selv ikke push, ligesom
// processPendingExpiry, det gør api/state.js. Sendes aldrig i nattetimerne;
// falder bare tilbage og prøver igen ved næste poll efter kl. 08.
function checkSilenceNudge(state) {
  if (state.closed || state.members.length < 2) return false;
  const lastEventTs = state.events.reduce((max, e) => Math.max(max, e.ts), 0);
  const lastActivity = Math.max(lastEventTs, state.dayBoundary, state.createdAt);
  const now = Date.now();
  if (now - lastActivity < SILENCE_NUDGE_AFTER) return false;
  if (state.lastSilenceNudgeAt && state.lastSilenceNudgeAt > lastActivity) return false;
  const hour = copenhagenLocalHour(now);
  if (hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END) return false;
  state.lastSilenceNudgeAt = now;
  return true;
}

const MILESTONE_STEP = 10; // fejrer hver 10€ i den aktive pulje

// Har puljen lige rundet et nyt 10€-mærke? Returnerer det nye mærke (eller
// null), og opdaterer state så det samme mærke ikke fejres to gange. Nulstilles
// ved "Gør op" (se settleRound), så en ny runde igen kan fejre fra 10€.
function checkPoolMilestone(state) {
  const total = state.events.filter(e => !e.free && !e.voided).length;
  const milestone = Math.floor(total / MILESTONE_STEP) * MILESTONE_STEP;
  if (milestone > 0 && milestone > (state.lastMilestoneAt || 0)) {
    state.lastMilestoneAt = milestone;
    return milestone;
  }
  return null;
}

// Finder Copenhagen-tidszonens offset (minutter) for et givent tidspunkt.
function copenhagenOffsetMinutes(ts) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: RESET_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const map = {};
  dtf.formatToParts(new Date(ts)).forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });
  const asIfUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute);
  return Math.round((asIfUTC - ts) / 60000);
}

// Tidspunktet for næste kl. 04 lokal tid, strengt efter `ts`.
function nextDailyReset(ts) {
  const offsetMin = copenhagenOffsetMinutes(ts);
  const local = new Date(ts + offsetMin * 60000);
  local.setUTCHours(RESET_HOUR, 0, 0, 0);
  let resetLocal = local.getTime();
  if (resetLocal <= ts + offsetMin * 60000) resetLocal += 86400000;
  return resetLocal - offsetMin * 60000;
}

// Opdaterer alles "dage uden brok"-streak (kun ud fra brok siden dayBoundary)
// og trækker tilfældigt lod om dagens gratis brok blandt alle medlemmer.
// Bruges både af den automatiske daglige afregning og af manuel "Gør op" —
// men rører ALDRIG selve puljen (events). Krukken tømmer ikke sig selv.
function updateStreaksAndDrawLottery(state) {
  const anyCount = {};
  state.members.forEach(m => (anyCount[m.id] = 0));
  state.events.forEach(e => {
    if (e.ts >= state.dayBoundary && anyCount[e.memberId] !== undefined) anyCount[e.memberId]++;
  });

  if (!state.streaks) state.streaks = {};
  state.members.forEach(m => {
    state.streaks[m.id] = (anyCount[m.id] || 0) === 0 ? (state.streaks[m.id] || 0) + 1 : 0;
  });

  // gratis brok trækkes ved rent lod blandt alle — ikke som en belønning for
  // god opførsel, det ville modarbejde hele pointen i at brokke sig mindst
  let nextFree = null;
  if (state.members.length > 1) {
    nextFree = state.members[Math.floor(Math.random() * state.members.length)].id;
  }
  state.freeBrokMemberId = nextFree;
  state.freeBrokDrawnAt = Date.now();
  state.dayBoundary = Date.now();
}

// Ny dag starter automatisk kl. 04 lokal tid: streaks og lodtrækning
// opdateres, men puljen (events) er urørt — den tømmes kun ved en bevidst
// "Gør op". Så det ikke kræver at nogen husker noget manuelt hver dag.
function autoSettleIfDue(state) {
  if (state.closed) return false;
  if (Date.now() < nextDailyReset(state.dayBoundary)) return false;
  updateStreaksAndDrawLottery(state);
  return true;
}

// Manuel "Gør op"/endelig lukning: arkiverer HELE den akkumulerede pulje i
// historikken og tømmer den — den eneste måde krukken reelt tømmes på.
// Opdaterer også streaks/lodtrækning for det stykke tid der lige er gået.
function settleRound(state) {
  updateStreaksAndDrawLottery(state);

  const totals = {};
  state.members.forEach(m => (totals[m.id] = 0));
  state.events.forEach(e => { if (!e.free && !e.voided && totals[e.memberId] !== undefined) totals[e.memberId]++; });

  state.history.push({
    startedAt: state.createdAt,
    closedAt: Date.now(),
    total: state.events.filter(e => !e.free && !e.voided).length,
    totals,
    events: state.events,
  });

  state.events = [];
  state.pendingList = [];
  state.lastMilestoneAt = 0; // ny runde, ny chance for at fejre 10€ igen
  return state;
}

async function getState(roomId) {
  const raw = await redis().get(KEY(roomId));
  if (!raw) return null;
  // upstash client auto-parses JSON if it was set as an object; handle both cases
  const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (state.closed === undefined) state.closed = false;
  if (!state.pushSubs) state.pushSubs = {};
  if (!state.streaks) state.streaks = {};
  if (state.goal === undefined) state.goal = '';
  if (!state.dayBoundary) state.dayBoundary = Date.now();
  if (state.freeBrokDrawnAt === undefined) state.freeBrokDrawnAt = null;
  if (!state.acquittals) state.acquittals = [];
  if (state.lastSilenceNudgeAt === undefined) state.lastSilenceNudgeAt = null;
  if (state.lastMilestoneAt === undefined) state.lastMilestoneAt = 0;
  if (!state.game) state.game = { active: false };
  // Selvhelbred spil der blev startet under en ældre version uden players-
  // feltet — de kan ikke renderes korrekt, så behandl dem som opgivet i
  // stedet for at lade klienten crashe stille når den forsøger at åbne dem.
  if (state.game.active && !state.game.players) state.game = { active: false };
  if (!state.gameStats) state.gameStats = {};
  if (state.gameEnabled === undefined) state.gameEnabled = true;
  if (state.kasseEnabled === undefined) state.kasseEnabled = true;
  if (!state.pendingList) {
    // migrering fra det gamle enkelt-pending-felt til en liste
    state.pendingList = state.pending ? [state.pending] : [];
  }
  delete state.pending;
  if (autoSettleIfDue(state)) await setState(roomId, state);
  return state;
}

async function setState(roomId, state) {
  await redis().set(KEY(roomId), JSON.stringify(state));
  return state;
}

async function createRoom(roomId, opts) {
  const existing = await getState(roomId);
  if (existing) return existing;
  const state = emptyState();
  if (opts && opts.kasseEnabled === false) state.kasseEnabled = false;
  if (opts && opts.gameEnabled === false) state.gameEnabled = false;
  await setState(roomId, state);
  return state;
}

function genRoomId() {
  const words = ['sol', 'strand', 'palme', 'bolge', 'sand', 'is', 'brise', 'skygge'];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.random().toString(36).slice(2, 6);
  return `${w}-${n}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function neededVotes(totalMembers) {
  const others = Math.max(totalMembers - 1, 1);
  return Math.min(others, Math.max(2, Math.ceil((others * 2) / 3)));
}

module.exports = { getState, setState, createRoom, genRoomId, uid, emptyState, neededVotes, isAdmin, settleRound, updateStreaksAndDrawLottery, processPendingExpiry, checkSilenceNudge, checkPoolMilestone };
