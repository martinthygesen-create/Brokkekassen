const { getState, setState } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });
    state.pending = null;
    await setState(roomId, state);
    res.status(200).json({ state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
