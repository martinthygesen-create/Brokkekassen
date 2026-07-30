const { redis } = require('./redis');

const KEY = (roomId) => `brokkekassen:room:${roomId}`;

// Den der opretter en brokkekasse er dens admin: den første, der nogensinde
// joiner rummet, bliver stående som members[0] og er dermed admin for altid.
function isAdmin(state, memberId) {
  return !!(state && state.members[0] && state.members[0].id === memberId);
}

function emptyState() {
  return {
    createdAt: Date.now(),
    members: [],   // {id, name}
    events: [],    // {id, memberId, message, ts, votes:[voterIds]}
    pending: null, // {id, memberId, message, votes:[voterIds]}
    history: [],   // {startedAt, closedAt, total, totals:{memberId:amt}, events:[...]}
  };
}

async function getState(roomId) {
  const raw = await redis().get(KEY(roomId));
  if (!raw) return null;
  // upstash client auto-parses JSON if it was set as an object; handle both cases
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
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

module.exports = { getState, setState, createRoom, genRoomId, uid, emptyState, neededVotes, isAdmin };
