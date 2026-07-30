const { getState, setState } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId, voterId, pendingId } = req.body || {};
    if (!roomId || !voterId || !pendingId) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });

    const pending = state.pendingList.find(p => p.id === pendingId);
    if (!pending) return res.status(409).json({ error: 'afstemningen er ikke længere aktiv — genindlæs og prøv igen' });

    const idx = pending.votes.indexOf(voterId);
    if (idx === -1) pending.votes.push(voterId);
    else pending.votes.splice(idx, 1);

    let confirmed = false;
    let free = false;
    if (pending.votes.length >= pending.need) {
      free = !!(state.freeBrokMemberId && state.freeBrokMemberId === pending.memberId);
      state.events.push({
        id: pending.id,
        memberId: pending.memberId,
        message: pending.message,
        ts: Date.now(),
        votes: pending.votes,
        free,
      });
      if (free) state.freeBrokMemberId = null;
      state.pendingList = state.pendingList.filter(p => p.id !== pendingId);
      confirmed = true;
    }
    await setState(roomId, state);
    res.status(200).json({ state, confirmed, free });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
