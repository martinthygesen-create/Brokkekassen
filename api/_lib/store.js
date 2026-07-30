const { redis } = require('./redis');

const KEY = (roomId) => `brokkekassen:room:${roomId}`;

// Den der opretter en brokkekasse er dens admin: den første, der nogensinde
// joiner rummet, bliver stående som members[0] og er dermed admin for altid.
function isAdmin(state, memberId) {
  return !!(state && state.members[0] && state.members[0].id === memberId);
}

const ROUND_MS = 24 * 60 * 60 * 1000;

function emptyState() {
  return {
    createdAt: Date.now(),
    members: [],   // {id, name}
    events: [],    // {id, memberId, message, ts, votes:[voterIds], free}
    pending: null, // {id, memberId, message, votes:[voterIds]}
    history: [],   // {startedAt, closedAt, total, totals:{memberId:amt}, events:[...]}
    freeBrokMemberId: null, // den der brokkede sig mindst sidste runde får ét gratis brok
    closed: false, // hele brokkekassen er lukket permanent (ingen flere brok)
  };
}

// Arkiverer den igangværende runde i historikken, tømmer puljen og kårer
// vinderen af næste runde gratis brok. Bruges både af manuel "Gør op" og af
// den automatiske daglige afregning.
function settleRound(state) {
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

  let nextFree = null;
  if (state.members.length > 1) {
    const min = Math.min(...state.members.map(m => totals[m.id] || 0));
    const candidates = state.members.filter(m => (totals[m.id] || 0) === min);
    nextFree = candidates[Math.floor(Math.random() * candidates.length)].id;
  }

  state.events = [];
  state.pending = null;
  state.createdAt = Date.now();
  state.freeBrokMemberId = nextFree;
  return state;
}

// Runder afsluttes automatisk hver 24 timer, så det ikke kræver at nogen
// husker at trykke "Gør op" manuelt hver dag.
function autoSettleIfDue(state) {
  if (state.closed) return false;
  if (!state.events.length) return false;
  if (Date.now() - state.createdAt < ROUND_MS) return false;
  settleRound(state);
  return true;
}

async function getState(roomId) {
  const raw = await redis().get(KEY(roomId));
  if (!raw) return null;
  // upstash client auto-parses JSON if it was set as an object; handle both cases
  const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (state.closed === undefined) state.closed = false;
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
