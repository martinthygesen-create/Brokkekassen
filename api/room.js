const { createRoom, genRoomId } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    let roomId = genRoomId();
    const state = await createRoom(roomId);
    res.status(200).json({ roomId, state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
