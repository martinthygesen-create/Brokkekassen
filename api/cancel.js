const { getState, setState, isAdmin } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId, actorId, pendingId } = req.body || {};
    if (!roomId || !pendingId) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });
    if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan afblæse' });
    state.pendingList = state.pendingList.filter(p => p.id !== pendingId);
    await setState(roomId, state);
    res.status(200).json({ state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
