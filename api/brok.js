const { getState, setState, uid, neededVotes } = require('./_lib/store');
const { pushToMembers } = require('./_lib/push');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId, memberId, message } = req.body || {};
    if (!roomId || !memberId) return res.status(400).json({ error: 'mangler data' });
    const cleanMessage = (message || '').toString().trim().slice(0, 80);
    if (!cleanMessage) return res.status(400).json({ error: 'skriv hvad de brokkede sig over — ellers ved ingen hvad de stemmer om' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });
    if (!state.members.find(m => m.id === memberId)) return res.status(400).json({ error: 'ukendt medlem' });
    if (state.closed) return res.status(400).json({ error: 'brokkekassen er lukket' });
    if (state.pendingList.some(p => p.memberId === memberId)) {
      return res.status(409).json({ error: 'der er allerede en afstemning i gang om denne person' });
    }

    state.pendingList.push({
      id: uid(),
      memberId,
      message: cleanMessage,
      votes: [],
      openedAt: Date.now(),
      need: neededVotes(state.members.length),
    });
    await setState(roomId, state);

    const accused = state.members.find(m => m.id === memberId);
    try {
      await pushToMembers(state, [memberId], {
        title: '🙄 Nogen brokker sig!',
        body: `${accused ? accused.name : 'Nogen'} er anklaget${cleanMessage ? ` — "${cleanMessage}"` : ''}. Kom og stem!`,
        url: '/?r=' + roomId,
      });
      await setState(roomId, state); // gemmer evt. oprydning af udløbne subscriptions
    } catch (e) { /* push-fejl må ikke vælte selve anklagelsen */ }

    res.status(200).json({ state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
