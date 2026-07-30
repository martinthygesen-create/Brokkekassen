const { getState, setState, emptyState, isAdminCode } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId, code } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'mangler data' });
    if (!isAdminCode(code)) return res.status(403).json({ error: 'kun admin kan nulstille' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });

    const fresh = emptyState();
    fresh.members = state.members;
    await setState(roomId, fresh);
    res.status(200).json({ state: fresh });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
