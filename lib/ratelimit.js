'use strict';
// Rate limiting stored in the database, so it works across serverless instances.
const db = require('./db');

// Count one event for `key` inside a window. Returns the number of events in the current window.
async function hit(key, windowMs) {
  const row = await db.one(
    `INSERT INTO rate_limits (key, count, reset_at)
     VALUES (?, 1, now() + (? * interval '1 millisecond'))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= now() THEN now() + (? * interval '1 millisecond') ELSE rate_limits.reset_at END
     RETURNING count`,
    [key, windowMs, windowMs]
  );
  if (Math.random() < 0.02) sweep().catch(() => {}); // occasional housekeeping
  return row.count;
}

// Number of events in the current window without counting a new one.
async function peek(key) {
  const row = await db.one('SELECT count FROM rate_limits WHERE key = ? AND reset_at > now()', [key]);
  return row ? row.count : 0;
}

// Housekeeping so the table stays small.
async function sweep() {
  await db.run("DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day'");
}

const TOO_MANY = { title: 'Too many attempts', message: 'Too many attempts. Please wait a little while and try again.' };

// Express middleware: counts every request from an IP address and blocks after `limit` in the window.
function perRequest({ name, windowMs, limit, message }) {
  return async (req, res, next) => {
    try {
      const n = await hit(`${name}:${req.ip}`, windowMs);
      if (n > limit) return res.status(429).render('error', { title: TOO_MANY.title, message: message || TOO_MANY.message });
      next();
    } catch (e) { next(e); }
  };
}

// Blocks once `limit` failures were recorded; the route calls `await req.recordFailure(extraKey)` on failure.
function perFailure({ name, windowMs, limit, message }) {
  return async (req, res, next) => {
    try {
      const key = `${name}:${req.ip}`;
      if ((await peek(key)) >= limit) return res.status(429).render('error', { title: TOO_MANY.title, message: message || TOO_MANY.message });
      req.recordFailure = async (extra) => {
        await hit(key, windowMs);
        if (extra) await hit(`${name}:${extra}`, windowMs);
      };
      req.rateBlockedFor = async (extra) => (extra ? (await peek(`${name}:${extra}`)) >= limit : false);
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { hit, peek, sweep, perRequest, perFailure };
