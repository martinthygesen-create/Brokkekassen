const { getState, setState, isAdmin } = require('./_lib/store');
const { pushToMembers } = require('./_lib/push');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId, actorId, message } = req.body || {};
    if (!roomId || !message || !message.trim()) return res.status(400).json({ error: 'mangler besked' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });
    if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan sende beskeder' });

    const cleanMessage = message.toString().trim().slice(0, 200);
    const sentTo = Object.keys(state.pushSubs || {}).length;
    await pushToMembers(state, [], {
      title: '🏖️ Brokkekassen',
      body: cleanMessage,
      url: '/?r=' + roomId,
    });
    await setState(roomId, state); // gemmer evt. oprydning af udløbne subscriptions
    res.status(200).json({ ok: true, sentTo });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
