const { getState, setState, processPendingExpiry, checkSilenceNudge, redactStateFor } = require('./_lib/store');
const { pushToMembers } = require('./_lib/push');

const SILENCE_LINES = [
  'Er alt for perfekt i dag? 🤔 Ingen har brokket sig i 24 timer... det virker mistænkeligt.',
  '24 timers stilhed i Brokkekassen. Enten er alt fantastisk, eller også holder nogen igen. 👀',
  'Boksen keder sig. Der må da være ét eneste lille brok i jer? 🫙',
  'Officiel påmindelse: at undertrykke sit brok er skadeligt for folkesundheden. Registrér det — for menneskehedens skyld. 🧑‍⚕️',
  'Videnskaben er enig: udiagnosticeret irritation vokser sig større i mørket. Bring det frem i lyset. 🔬',
  'Denne besked er en tjeneste fra Brokkekassen: husk at registrere jeres brok, som samfundsansvarlige borgere. 🫡',
];

module.exports = async (req, res) => {
  const roomId = (req.query.room || '').toString().trim();
  const memberId = (req.query.member || '').toString().trim();
  if (!roomId) return res.status(400).json({ error: 'mangler room' });
  try {
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });

    // Klienterne poller herind hvert par sekunder mens appen er åben, så det
    // er her (i stedet for en rigtig cron-service) vi opportunistisk tjekker
    // hængende anklager for reminder/udløb.
    const dueReminders = processPendingExpiry(state);
    const nudgeSilence = checkSilenceNudge(state);
    if (dueReminders.length || nudgeSilence) await setState(roomId, state);

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

    if (nudgeSilence) {
      try {
        await pushToMembers(state, [], {
          title: '🏖️ Brokkekassen',
          body: SILENCE_LINES[Math.floor(Math.random() * SILENCE_LINES.length)],
          url: '/?r=' + roomId,
        });
      } catch (e) { /* push-fejl må ikke vælte state-kaldet */ }
    }

    res.status(200).json({ state: redactStateFor(state, memberId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
