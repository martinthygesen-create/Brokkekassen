const { getState, setState, isAdminCode } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId, code } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'mangler data' });
    if (!isAdminCode(code)) return res.status(403).json({ error: 'kun admin kan gøre op' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });
    if (!state.events.length) return res.status(400).json({ error: 'puljen er tom' });

    const totals = {};
    state.members.forEach(m => (totals[m.id] = 0));
    state.events.forEach(e => { if (totals[e.memberId] !== undefined) totals[e.memberId]++; });

    state.history.push({
      startedAt: state.createdAt,
      closedAt: Date.now(),
      total: state.events.length,
      totals,
      events: state.events,
    });
    state.events = [];
    state.pending = null;
    state.createdAt = Date.now();
    await setState(roomId, state);
    res.status(200).json({ state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
