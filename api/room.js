const { createRoom, genRoomId } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    let roomId = genRoomId();
    const kasseEnabled = !(req.body && req.body.kasseEnabled === false);
    const gameEnabled = !(req.body && req.body.gameEnabled === false);
    if (!kasseEnabled && !gameEnabled) return res.status(400).json({ error: 'vælg mindst én af de to' });
    const state = await createRoom(roomId, { kasseEnabled, gameEnabled });
    res.status(200).json({ roomId, state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
