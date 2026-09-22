'use strict';
// Postgres access that works on serverless hosts (Vercel).
//   - Production / Vercel: set DATABASE_URL (or POSTGRES_URL), for example from a free Neon database.
//   - Local development and tests without a database: falls back to PGlite (an embedded Postgres
//     that is only installed as a dev dependency).
const path = require('path');
const config = require('./config');

const url = config.databaseUrl;
let driver; // { query(sql, params) -> { rows, rowCount }, tx(fn) }

if (url) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ...(process.env.DATABASE_SSL === 'false' ? { ssl: false } : {}),
  });
  pool.on('error', (e) => console.error('Postgres pool error:', e.message));
  driver = {
    kind: 'pg',
    query: (sql, params) => pool.query(sql, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: (s, p) => client.query(s, p) });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        throw e;
      } finally {
        client.release();
      }
    },
  };
} else {
  if (config.isProd) {
    console.error('FATAL: DATABASE_URL is not set. Add a Postgres database (for example Neon) and set DATABASE_URL.');
    process.exit(1);
  }
  let PGlite;
  try {
    // The package name is kept in a variable so hosting tools do not bundle this development-only database.
    const pgliteName = '@electric-sql/pglite';
    ({ PGlite } = require(pgliteName));
  } catch (_) {
    console.error('DATABASE_URL is not set and @electric-sql/pglite is not installed. Run "npm install" or set DATABASE_URL.');
    process.exit(1);
  }
  const memory = process.env.PGLITE_MEMORY === '1';
  const pg = memory ? new PGlite() : new PGlite(path.join(config.dataDir, 'pglite'));
  driver = {
    kind: 'pglite',
    query: (sql, params) => pg.query(sql, params),
    tx: (fn) => pg.transaction((t) => fn({ query: (s, p) => t.query(s, p) })),
  };
}

// Write queries with "?" placeholders; they are converted to $1, $2, ...
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','student')),
  password_hash TEXT,
  invite_token_hash TEXT,
  invite_expires TIMESTAMPTZ,
  active INTEGER NOT NULL DEFAULT 1,
  session_version INTEGER NOT NULL DEFAULT 1,
  lead_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS class_sessions (
  id SERIAL PRIMARY KEY,
  starts_at TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL DEFAULT 'Free SAT/ACT Math Class',
  zoom_url TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 40,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  who TEXT NOT NULL DEFAULT 'parent',
  class_session_id INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'registered',
  notes TEXT NOT NULL DEFAULT '',
  sms_consent INTEGER NOT NULL DEFAULT 0,
  consent_text TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL,
  consent_ip TEXT,
  user_agent TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reply TEXT,
  replied_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);
`;

const db = {
  kind: driver.kind,
  async query(sql, params = []) {
    const r = await driver.query(toPg(sql), params);
    return r.rows;
  },
  async one(sql, params = []) {
    const r = await driver.query(toPg(sql), params);
    return r.rows[0];
  },
  // For INSERT/UPDATE/DELETE: returns the number of rows changed (and rows when RETURNING is used).
  async run(sql, params = []) {
    const r = await driver.query(toPg(sql), params);
    return { rowCount: r.rowCount != null ? r.rowCount : r.affectedRows || 0, rows: r.rows };
  },
  async insert(sql, params = []) {
    const r = await driver.query(toPg(sql + ' RETURNING id'), params);
    return r.rows[0].id;
  },
};

// Creates the tables once per server instance and seeds the first admin account.
let readyPromise = null;
db.ready = function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const exists = await driver.query("SELECT to_regclass('public.rate_limits') AS t");
      if (!exists.rows[0].t) {
        await driver.tx(async (t) => {
          if (driver.kind === 'pg') await t.query('SELECT pg_advisory_xact_lock(84213)'); // avoid races between cold starts
          // One statement per call: prepared statements cannot hold several commands.
          for (const stmt of SCHEMA.split(';').map((x) => x.trim()).filter(Boolean)) await t.query(stmt);
        });
      }
      await seedAdmin();
    })().catch((e) => { readyPromise = null; throw e; });
  }
  return readyPromise;
};

async function seedAdmin() {
  const { email, password } = config.admin;
  if (!email || !password) return;
  const existing = await db.one("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existing) return;
  if (password.length < 10) {
    console.error('ADMIN_PASSWORD must be at least 10 characters. Admin account was not created.');
    return;
  }
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(password, 12);
  await db.run(
    "INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, 'admin', ?) ON CONFLICT (email) DO NOTHING",
    [email, 'Administrator', hash]
  );
  console.log(`Created admin account for ${email}`);
}

module.exports = db;
