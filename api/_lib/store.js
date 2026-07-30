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
    createdAt: Date.now(),
    members: [],   // {id, name}
    events: [],    // {id, memberId, message, ts, votes:[voterIds], free}
    pending: null, // {id, memberId, message, votes:[voterIds]}
    history: [],   // {startedAt, closedAt, total, totals:{memberId:amt}, events:[...]}
    freeBrokMemberId: null, // dagens heldige vinder af gratis brok, trukket tilfældigt
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

// Arkiverer den igangværende runde i historikken (hvis der var nogen brok),
// tømmer puljen, opdaterer alles "dage uden brok"-streak, og trækker
// tilfældigt lod om dagens gratis brok blandt alle medlemmer. Bruges både af
// manuel "Gør op", den endelige lukning og den automatiske daglige afregning.
function settleRound(state, { skipHistoryIfEmpty } = {}) {
  const totals = {};    // betalende brok (til regnskab/historik)
  const anyCount = {};  // alle brok inkl. gratis (til streak-beregning)
  state.members.forEach(m => { totals[m.id] = 0; anyCount[m.id] = 0; });
  state.events.forEach(e => {
    if (anyCount[e.memberId] !== undefined) anyCount[e.memberId]++;
    if (!e.free && totals[e.memberId] !== undefined) totals[e.memberId]++;
  });

  if (state.events.length || !skipHistoryIfEmpty) {
    state.history.push({
      startedAt: state.createdAt,
      closedAt: Date.now(),
      total: state.events.filter(e => !e.free).length,
      totals,
      events: state.events,
    });
  }

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

  state.events = [];
  state.pending = null;
  state.createdAt = Date.now();
  state.freeBrokMemberId = nextFree;
  return state;
}

// Ny runde starter automatisk hver dag kl. 04 lokal tid, så det ikke kræver
// at nogen husker at trykke "Gør op" manuelt.
function autoSettleIfDue(state) {
  if (state.closed) return false;
  if (Date.now() < nextDailyReset(state.createdAt)) return false;
  settleRound(state, { skipHistoryIfEmpty: true });
  return true;
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

module.exports = { getState, setState, createRoom, genRoomId, uid, emptyState, neededVotes, isAdmin, settleRound };
