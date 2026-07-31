const { getState, setState, emptyState, isAdmin, settleRound, updateStreaksAndDrawLottery } = require('./_lib/store');
const { pushToMembers } = require('./_lib/push');

// Samler admin-handlingerne (gør op, luk, nulstil, besked, mål) i én
// serverless function i stedet for fem — Vercels Hobby-plan tillader kun
// 12 functions i alt, og hver fil under /api tæller som én.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const { action, roomId, actorId } = req.body || {};
    if (!roomId) return res.status(400).json({ error: 'mangler data' });
    const state = await getState(roomId);
    if (!state) return res.status(404).json({ error: 'ukendt brokkekasse' });

    if (action === 'settle') {
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan gøre op' });
      if (!state.events.length) return res.status(400).json({ error: 'puljen er tom' });
      settleRound(state);
      await setState(roomId, state);
      return res.status(200).json({ state });
    }

    if (action === 'close') {
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan lukke den' });
      if (state.closed) return res.status(400).json({ error: 'brokkekassen er allerede lukket' });
      if (state.events.length) settleRound(state);
      state.pendingList = [];
      state.closed = true;
      await setState(roomId, state);
      return res.status(200).json({ state });
    }

    if (action === 'undoArchive') {
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan gøre dette' });
      if (!state.history.length) return res.status(400).json({ error: 'ingen tidligere opgørelse at fortryde' });
      const last = state.history.pop();
      state.events = [...last.events, ...state.events];
      state.createdAt = last.startedAt;
      await setState(roomId, state);
      return res.status(200).json({ state });
    }

    if (action === 'testDraw') {
      // Kun til at forhåndsvise spillemaskinen uden at vente på et rigtigt
      // dagsskifte — trækker en ny lodtrækning og opdaterer streaks med det
      // samme, ellers samme logik som den automatiske daglige proces.
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan teste dette' });
      if (state.members.length < 2) return res.status(400).json({ error: 'kræver mindst 2 medlemmer for at trække lod' });
      updateStreaksAndDrawLottery(state);
      await setState(roomId, state);
      return res.status(200).json({ state });
    }

    if (action === 'reset') {
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan nulstille' });
      const fresh = emptyState();
      fresh.members = state.members;
      await setState(roomId, fresh);
      return res.status(200).json({ state: fresh });
    }

    if (action === 'broadcast') {
      const { message } = req.body || {};
      if (!message || !message.trim()) return res.status(400).json({ error: 'mangler besked' });
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan sende beskeder' });
      const cleanMessage = message.toString().trim().slice(0, 200);
      await pushToMembers(state, [], {
        title: '🏖️ Brokkekassen',
        body: cleanMessage,
        url: '/?r=' + roomId,
      });
      const sentTo = Object.keys(state.pushSubs || {}).length;
      await setState(roomId, state); // gemmer evt. oprydning af udløbne subscriptions
      return res.status(200).json({ ok: true, sentTo });
    }

    if (action === 'goal') {
      const { goal } = req.body || {};
      if (!isAdmin(state, actorId)) return res.status(403).json({ error: 'kun den der oprettede brokkekassen kan sætte mål' });
      state.goal = (goal || '').toString().trim().slice(0, 100);
      await setState(roomId, state);
      return res.status(200).json({ state });
    }

    return res.status(400).json({ error: 'ukendt handling' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
