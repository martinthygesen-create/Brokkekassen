const { getState, setState, uid, neededVotes } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId, memberId, message } = req.body || {};
    if (!roomId || !memberId) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });
    if (!state.members.find(m => m.id === memberId)) return res.status(400).json({ error: 'ukendt medlem' });

    state.pending = {
      id: uid(),
      memberId,
      message: (message || '').toString().trim().slice(0, 80),
      votes: [],
      openedAt: Date.now(),
      need: neededVotes(state.members.length),
    };
    await setState(roomId, state);
    res.status(200).json({ state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
