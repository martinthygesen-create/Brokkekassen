const { getState, setState } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId, memberId, subscription } = req.body || {};
    if (!roomId || !memberId || !subscription) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });
    if (!state.members.find(m => m.id === memberId)) return res.status(400).json({ error: 'ukendt medlem' });

    if (!state.pushSubs) state.pushSubs = {};
    state.pushSubs[memberId] = subscription;
    await setState(roomId, state);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
