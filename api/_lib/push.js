const webpush = require('web-push');

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error('Mangler VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:brokkekassen@example.com', publicKey, privateKey);
  configured = true;
}

// Sender en push til alle medlemmer i pushSubs undtagen dem i excludeIds.
// Fejlende (fx udløbne) subscriptions fjernes stille fra state.
async function pushToMembers(state, excludeIds, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  ensureConfigured();
  const subs = state.pushSubs || {};
  const json = JSON.stringify(payload);
  const results = await Promise.allSettled(
    Object.entries(subs)
      .filter(([memberId]) => !excludeIds.includes(memberId))
      .map(([memberId, sub]) => webpush.sendNotification(sub, json).catch(err => { throw { memberId, err }; }))
  );
  results.forEach(r => {
    if (r.status === 'rejected' && r.reason && r.reason.memberId && (r.reason.err.statusCode === 404 || r.reason.err.statusCode === 410)) {
      delete state.pushSubs[r.reason.memberId];
    }
  });
}

module.exports = { pushToMembers };
