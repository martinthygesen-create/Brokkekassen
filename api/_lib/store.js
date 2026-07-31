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
  };
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
  state.events.forEach(e => { if (!e.free && totals[e.memberId] !== undefined) totals[e.memberId]++; });

  state.history.push({
    startedAt: state.createdAt,
    closedAt: Date.now(),
    total: state.events.filter(e => !e.free).length,
    totals,
    events: state.events,
  });

  state.events = [];
  state.pendingList = [];
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

async function createRoom(roomId) {
  const existing = await getState(roomId);
  if (existing) return existing;
  const state = emptyState();
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

module.exports = { getState, setState, createRoom, genRoomId, uid, emptyState, neededVotes, isAdmin, settleRound, updateStreaksAndDrawLottery };
