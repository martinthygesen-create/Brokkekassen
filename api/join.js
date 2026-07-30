const { getState, setState, uid } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { roomId, name, email } = req.body || {};
    if (!roomId || !name || !name.trim()) return res.status(400).json({ error: 'mangler navn' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });

    const cleanName = name.trim().slice(0, 24);
    let member = state.members.find(m => m.name.toLowerCase() === cleanName.toLowerCase());
    if (!member) {
      member = { id: uid(), name: cleanName, email: email ? email.trim().slice(0, 80) : null };
      state.members.push(member);
      await setState(roomId, state);
    }
    res.status(200).json({ memberId: member.id, state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
