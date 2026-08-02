const { getState, setState, processPendingExpiry } = require('./_lib/store');
const { pushToMembers } = require('./_lib/push');

module.exports = async (req, res) => {
  const roomId = (req.query.room || '').toString().trim();
  if (!roomId) return res.status(400).json({ error: 'mangler room' });
  try {
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });

    // Klienterne poller herind hvert par sekunder mens appen er åben, så det
    // er her (i stedet for en rigtig cron-service) vi opportunistisk tjekker
    // hængende anklager for reminder/udløb.
    const dueReminders = processPendingExpiry(state);
    if (dueReminders.length) await setState(roomId, state);

    for (const { pending, memberIds } of dueReminders) {
      const accused = state.members.find(m => m.id === pending.memberId);
      try {
        await pushToMembers(state, state.members.map(m => m.id).filter(id => !memberIds.includes(id)), {
          title: '🙄 Husk at stemme!',
          body: `${accused ? accused.name : 'Nogen'} er stadig anklaget${pending.message ? ` — "${pending.message}"` : ''}. Sagen udløber om 12 timer.`,
          url: '/?r=' + roomId,
        });
      } catch (e) { /* push-fejl må ikke vælte state-kaldet */ }
    }

    res.status(200).json({ state });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
