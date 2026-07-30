const { Redis } = require('@upstash/redis');

let client = null;
function redis() {
  if (!client) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error('Mangler UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN i Vercel Environment Variables.');
    }
    client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return client;
}

module.exports = { redis };
