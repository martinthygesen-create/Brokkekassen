const { getState, setState } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId, voterId } = req.body || {};
    if (!roomId || !voterId) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });
    if (!state.pending) return res.status(400).json({ error: 'ingen aktiv afstemning' });
    if (state.pending.memberId === voterId) return res.status(400).json({ error: 'du kan ikke stemme på dig selv' });

    const idx = state.pending.votes.indexOf(voterId);
    if (idx === -1) state.pending.votes.push(voterId);
    else state.pending.votes.splice(idx, 1);

    let confirmed = false;
    if (state.pending.votes.length >= state.pending.need) {
      state.events.push({
        id: state.pending.id,
        memberId: state.pending.memberId,
        message: state.pending.message,
        ts: Date.now(),
        votes: state.pending.votes,
      });
      state.pending = null;
      confirmed = true;
    }
    await setState(roomId, state);
    res.status(200).json({ state, confirmed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
