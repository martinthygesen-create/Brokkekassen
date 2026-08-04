const { getState, setState, checkPoolMilestone } = require('./_lib/store');
const { pushToMembers } = require('./_lib/push');

const MILESTONE_LINES = [
  m => `🎉 Puljen har rundet ${m}€! Det bliver et godt indkøb.`,
  m => `🥳 ${m}€ i Brokkekassen. I er godt i gang!`,
  m => `💰 Ding ding — ${m}€ nået. Fortsæt endelig sådan (eller lad være).`,
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId, voterId, pendingId } = req.body || {};
    if (!roomId || !voterId || !pendingId) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });

    const pending = state.pendingList.find(p => p.id === pendingId);
    if (!pending) return res.status(409).json({ error: 'afstemningen er ikke længere aktiv — genindlæs og prøv igen' });

    const idx = pending.votes.indexOf(voterId);
    if (idx === -1) pending.votes.push(voterId);
    else pending.votes.splice(idx, 1);

    let confirmed = false;
    let free = false;
    if (pending.votes.length >= pending.need) {
      free = !!(state.freeBrokMemberId && state.freeBrokMemberId === pending.memberId);
      state.events.push({
        id: pending.id,
        memberId: pending.memberId,
        message: pending.message,
        ts: Date.now(),
        votes: pending.votes,
        free,
      });
      if (free) state.freeBrokMemberId = null;
      state.pendingList = state.pendingList.filter(p => p.id !== pendingId);
      confirmed = true;
    }
    const milestone = confirmed ? checkPoolMilestone(state) : null;
    await setState(roomId, state);

    if (milestone) {
      try {
        const line = MILESTONE_LINES[Math.floor(Math.random() * MILESTONE_LINES.length)](milestone);
        await pushToMembers(state, [], { title: '🏖️ Brokkekassen', body: line, url: '/?r=' + roomId });
      } catch (e) { /* push-fejl må ikke vælte selve stemmen */ }
    }

    res.status(200).json({ state, confirmed, free });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
