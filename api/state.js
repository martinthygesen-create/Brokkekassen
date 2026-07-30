const { getState } = require('./_lib/store');

module.exports = async (req, res) => {
  const roomId = (req.query.room || '').toString().trim();
  if (!roomId) return res.status(400).json({ error: 'mangler room' });
  try {
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });
    res.status(200).json({ state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
