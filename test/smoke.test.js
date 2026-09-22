'use strict';
// End-to-end smoke test: node test/smoke.test.js
const assert = require('assert');

// By default the tests use an in-memory PGlite database (embedded Postgres), so no database server is needed.
// To run them against a real Postgres server instead (this ERASES that database):
//   TEST_DATABASE_URL=postgres://user@localhost:5432/scratch DATABASE_SSL=false npm run test:pg
delete process.env.POSTGRES_URL;
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  process.env.PGLITE_MEMORY = '1';
  delete process.env.DATABASE_URL;
}
process.env.ADMIN_EMAIL = 'owner@example.com';
process.env.ADMIN_PASSWORD = 'correct-horse-battery';
process.env.SESSION_SECRET = 'test-secret';
process.env.BUSINESS_NAME = 'Test Math Prep';
process.env.SITE_URL = 'http://localhost';
delete process.env.NODE_ENV;

const { createApp } = require('../server');
const db = require('../lib/db');

let passed = 0;
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok   ' + name); })
    .catch((e) => { console.error('  FAIL ' + name + '\n       ' + (e && e.message)); process.exitCode = 1; });
}

class Client {
  constructor(base) { this.base = base; this.jar = {}; }
  async req(method, url, { form, headers = {} } = {}) {
    const h = { ...headers };
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(this.base + url, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), val = pair.slice(i + 1);
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) delete this.jar[name]; else this.jar[name] = val;
    }
    res.text_ = await res.text();
    return res;
  }
  get(url, o) { return this.req('GET', url, o); }
  post(url, form, o = {}) { return this.req('POST', url, { ...o, form }); }
  csrf(html) { const m = /name="_csrf" value="([^"]+)"/.exec(html); return m && m[1]; }
}

(async () => {
  if (process.env.TEST_DATABASE_URL) {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
  }
  const app = createApp();
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const anon = new Client(base);
  const admin = new Client(base);
  const student = new Client(base);
  console.log('Running smoke tests against ' + base);

  await ok('landing page loads with form, privacy link and strict headers', async () => {
    const r = await anon.get('/');
    assert.equal(r.status, 200);
    assert.match(r.text_, /Free Live SAT/);
    assert.match(r.text_, /href="\/privacy"/);
    assert.match(r.text_, /name="phone"/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.getSetCookie().length, 0, 'anonymous visitors should not receive cookies');
  });

  await ok('policy and info pages load', async () => {
    for (const p of ['/privacy', '/terms', '/refund-policy', '/data-deletion', '/contact', '/enroll', '/robots.txt', '/sitemap.xml', '/health']) {
      const r = await anon.get(p);
      assert.equal(r.status, 200, p);
    }
    const priv = (await anon.get('/privacy')).text_;
    assert.match(priv, /Test Math Prep/);
    assert.match(priv, /Meta Pixel/);
  });

  await ok('bootcamp page reflects 120-minute Saturday/Sunday sessions and $299', async () => {
    const t = (await anon.get('/enroll')).text_;
    assert.match(t, /120 minutes/);
    assert.match(t, /Saturday/);
    assert.match(t, /Sunday/);
    assert.match(t, /\$299/);
  });

  await ok('unknown page returns 404', async () => {
    assert.equal((await anon.get('/nope')).status, 404);
  });

  await ok('protected pages redirect anonymous visitors to login', async () => {
    for (const p of ['/admin', '/admin/leads', '/portal', '/portal/account']) {
      const r = await anon.get(p);
      assert.equal(r.status, 302, p);
      assert.equal(r.headers.get('location'), '/login');
    }
  });

  await ok('invalid sign-up is rejected and nothing is stored', async () => {
    const r = await anon.post('/register', { name: 'A', phone: '123', email: 'bad', who: 'parent' });
    assert.equal(r.status, 422);
    assert.match(r.text_, /10-digit US phone/);
    assert.match(r.text_, /valid email/);
    assert.equal((await db.one('SELECT COUNT(*)::int c FROM leads')).c, 0);
  });

  await ok('admin can log in (wrong password rejected first)', async () => {
    let r = await admin.get('/login');
    let token = admin.csrf(r.text_);
    assert.ok(token);
    r = await admin.post('/login', { _csrf: token, email: 'owner@example.com', password: 'wrong-password' });
    assert.equal(r.status, 401);
    token = admin.csrf(r.text_) || token;
    r = await admin.get('/login');
    token = admin.csrf(r.text_);
    r = await admin.post('/login', { _csrf: token, email: 'owner@example.com', password: 'correct-horse-battery' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/admin');
    r = await admin.get('/admin');
    assert.equal(r.status, 200);
    assert.match(r.text_, /Dashboard/);
    assert.match(r.text_, /finish these settings/);
  });

  await ok('login without CSRF token is refused', async () => {
    const c = new Client(base);
    await c.get('/login');
    const r = await c.post('/login', { email: 'owner@example.com', password: 'correct-horse-battery' });
    assert.equal(r.status, 403);
  });

  await ok('cross-site POST is blocked', async () => {
    const r = await anon.post('/register', { name: 'Eve Evil', phone: '5555551234', email: 'e@e.com' }, { headers: { origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
  });

  await ok('same-origin and "null" origin form posts are accepted, referrer policy is not no-referrer', async () => {
    const r = await anon.get('/');
    assert.notEqual(r.headers.get('referrer-policy'), 'no-referrer');
    const a = await anon.post('/register', { name: 'x' }, { headers: { origin: 'null' } });
    assert.equal(a.status, 422, 'origin null must not be treated as an attack');
    const b = await anon.post('/register', { name: 'x' }, { headers: { origin: base } });
    assert.equal(b.status, 422);
  });

  let sessionId;
  await ok('admin adds a class date and it shows on the landing page', async () => {
    let r = await admin.get('/admin/sessions');
    const token = admin.csrf(r.text_);
    // A missing token must be refused.
    r = await admin.post('/admin/sessions', { starts_at: '2030-10-06T19:00', capacity: '40' });
    assert.equal(r.status, 403);
    r = await admin.post('/admin/sessions', { _csrf: token, starts_at: '2030-10-06T19:00', capacity: '40', zoom_url: 'https://zoom.us/j/123', title: 'Free SAT/ACT Math Class' });
    assert.equal(r.status, 302);
    const row = await db.one('SELECT * FROM class_sessions');
    sessionId = row.id;
    assert.equal(row.starts_at.toISOString(), '2030-10-06T23:00:00.000Z', 'ET evening stored as UTC (EDT is UTC-4)');
    const home = (await anon.get('/')).text_;
    assert.match(home, /Sunday, October 6 at 7:00 PM ET/);
  });

  await ok('valid sign-up is stored with consent record, redirects to thank-you page', async () => {
    const r = await anon.post('/register', {
      name: 'Pat Parent', phone: '555-555-1234', email: 'Pat@Example.com', who: 'parent',
      class_session_id: String(sessionId), confirm_age: '1', agree_privacy: '1', sms_consent: '1',
      utm_source: 'facebook', utm_campaign: 'fall',
    });
    assert.equal(r.status, 302, r.text_.slice(0, 300));
    assert.equal(r.headers.get('location'), `/thanks?s=${sessionId}`);
    const lead = await db.one('SELECT * FROM leads');
    assert.equal(lead.email, 'pat@example.com');
    assert.equal(lead.phone, '(555) 555-1234');
    assert.equal(lead.sms_consent, 1);
    assert.match(lead.consent_text, /text me/);
    assert.ok(lead.consent_at);
    assert.equal(lead.utm_source, 'facebook');
    const t = (await anon.get(`/thanks?s=${sessionId}`)).text_;
    assert.match(t, /zoom\.us\/j\/123/);
    assert.match(t, /data-track="lead"/);
    const ics = await anon.get(`/class/${sessionId}.ics`);
    assert.equal(ics.status, 200);
    assert.match(ics.text_, /DTSTART:20301006T230000Z/);
    assert.match(ics.text_, /DTEND:20301007T000000Z/);
  });

  await ok('registering twice with the same email does not duplicate the lead', async () => {
    await anon.post('/register', { name: 'Pat Parent', phone: '5555551234', email: 'pat@example.com', class_session_id: String(sessionId), confirm_age: '1', agree_privacy: '1' });
    assert.equal((await db.one('SELECT COUNT(*)::int c FROM leads')).c, 1);
    assert.equal((await db.one('SELECT sms_consent FROM leads')).sms_consent, 0, 'latest consent choice wins');
  });

  await ok('sign-up without the required checkboxes is refused', async () => {
    const r = await anon.post('/register', { name: 'No Consent', phone: '5555551235', email: 'nc@example.com', class_session_id: String(sessionId) });
    assert.equal(r.status, 422);
    assert.match(r.text_, /Please confirm/);
    assert.equal((await db.one("SELECT COUNT(*)::int c FROM leads WHERE email = 'nc@example.com'")).c, 0);
  });

  await ok('bot honeypot silently drops the sign-up', async () => {
    const r = await anon.post('/register', { name: 'Bot Bot', phone: '5555551236', email: 'bot@example.com', website: 'http://spam', confirm_age: '1', agree_privacy: '1', class_session_id: String(sessionId) });
    assert.equal(r.status, 302);
    assert.equal((await db.one("SELECT COUNT(*)::int c FROM leads WHERE email = 'bot@example.com'")).c, 0);
  });

  let inviteLink;
  await ok('admin sees the lead, exports CSV, and creates a student login link', async () => {
    let r = await admin.get('/admin/leads');
    assert.match(r.text_, /Pat Parent/);
    const token = admin.csrf(r.text_);
    r = await admin.get('/admin/leads.csv');
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.text_, /pat@example.com/);
    const lead = await db.one('SELECT id FROM leads');
    r = await admin.post(`/admin/leads/${lead.id}/invite`, { _csrf: token });
    assert.equal(r.status, 200);
    const m = /(http:\/\/localhost\/setup\/[\w-]+)/.exec(r.text_);
    assert.ok(m, 'invite link shown');
    inviteLink = m[1].replace('http://localhost', '');
    assert.equal((await db.one('SELECT status FROM leads')).status, 'enrolled');
    const u = await db.one("SELECT * FROM users WHERE role='student'");
    assert.ok(!u.invite_token_hash.includes(inviteLink.split('/').pop()), 'token stored hashed');
  });

  await ok('student sets a password (weak password refused) and logs in', async () => {
    let r = await student.get(inviteLink);
    assert.equal(r.status, 200);
    let token = student.csrf(r.text_);
    r = await student.post(inviteLink, { _csrf: token, password: 'short', password2: 'short' });
    assert.equal(r.status, 422);
    token = student.csrf(r.text_);
    r = await student.post(inviteLink, { _csrf: token, password: 'a-good-long-password', password2: 'a-good-long-password' });
    assert.equal(r.status, 302);
    assert.equal((await anon.get(inviteLink)).status, 410, 'link cannot be reused');
    r = await student.get('/login');
    token = student.csrf(r.text_);
    r = await student.post('/login', { _csrf: token, email: 'pat@example.com', password: 'a-good-long-password' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/portal');
    r = await student.get('/portal');
    assert.equal(r.status, 200);
    assert.match(r.text_, /Welcome, Pat/);
  });

  await ok('student cannot open admin pages', async () => {
    const r = await student.get('/admin/leads');
    assert.equal(r.status, 403);
  });

  await ok('student sends a message, admin replies, student sees the reply', async () => {
    let r = await student.get('/portal');
    let token = student.csrf(r.text_);
    r = await student.post('/portal/messages', { _csrf: token, subject: 'Target score', body: 'I want a 700 in math <script>alert(1)</script>' });
    assert.equal(r.status, 302);
    r = await admin.get('/admin/messages');
    assert.match(r.text_, /Target score/);
    assert.ok(!r.text_.includes('<script>alert(1)</script>'), 'message text is escaped');
    token = admin.csrf(r.text_);
    const m = await db.one('SELECT id FROM messages');
    r = await admin.post(`/admin/messages/${m.id}/reply`, { _csrf: token, reply: 'Great goal. See you Saturday.' });
    assert.equal(r.status, 302);
    r = await student.get('/portal');
    assert.match(r.text_, /See you Saturday/);
  });

  await ok('admin posts material and announcement that students see', async () => {
    let r = await admin.get('/admin/content');
    const token = admin.csrf(r.text_);
    await admin.post('/admin/materials', { _csrf: token, title: 'Day 1 playbook', url: 'https://example.com/playbook.pdf', description: 'PDF', sort: '1' });
    r = await admin.post('/admin/materials', { _csrf: token, title: 'Bad link', url: 'javascript:alert(1)' });
    await admin.post('/admin/announcements', { _csrf: token, title: 'Zoom link', body: 'Saturday 10am' });
    r = await student.get('/portal');
    assert.match(r.text_, /Day 1 playbook/);
    assert.match(r.text_, /Zoom link/);
    assert.ok(!r.text_.includes('Bad link'), 'javascript: URLs are rejected');
  });

  await ok('changing the password signs the student out on other devices', async () => {
    const other = new Client(base);
    let r = await other.get('/login');
    r = await other.post('/login', { _csrf: other.csrf(r.text_), email: 'pat@example.com', password: 'a-good-long-password' });
    assert.equal(r.status, 302);
    assert.equal((await other.get('/portal')).status, 200);
    r = await student.get('/portal/account');
    const token = student.csrf(r.text_);
    r = await student.post('/portal/account', { _csrf: token, current: 'wrong-current', password: 'another-long-password-2', password2: 'another-long-password-2' });
    assert.equal(r.status, 422);
    r = await student.post('/portal/account', { _csrf: token, current: 'a-good-long-password', password: 'another-long-password-2', password2: 'another-long-password-2' });
    assert.equal(r.status, 302);
    assert.equal((await student.get('/portal')).status, 200, 'this device stays signed in');
    r = await other.get('/portal');
    assert.equal(r.status, 302, 'other device is signed out');
    assert.equal(r.headers.get('location'), '/login');
  });

  await ok('a tampered session cookie is rejected', async () => {
    const c = new Client(base);
    let r = await c.get('/login');
    r = await c.post('/login', { _csrf: c.csrf(r.text_), email: 'pat@example.com', password: 'another-long-password-2' });
    assert.equal(r.status, 302);
    const forged = Buffer.from(JSON.stringify({ userId: 1, sv: 1 })).toString('base64');
    const f = new Client(base);
    f.jar.sid = forged;
    f.jar['sid.sig'] = 'AAAAAAAAAAAAAAAAAAAAAAAAAAA';
    assert.equal((await f.get('/admin')).status, 302, 'forged admin cookie does not work');
  });

  await ok('logout ends the session', async () => {
    let r = await student.get('/portal');
    const token = student.csrf(r.text_);
    r = await student.post('/logout', { _csrf: token });
    assert.equal(r.status, 302);
    r = await student.get('/portal');
    assert.equal(r.status, 302);
  });

  await ok('deactivating a student signs them out and blocks new logins', async () => {
    const u = await db.one("SELECT id FROM users WHERE role='student'");
    const live = new Client(base);
    let r = await live.get('/login');
    r = await live.post('/login', { _csrf: live.csrf(r.text_), email: 'pat@example.com', password: 'another-long-password-2' });
    assert.equal(r.status, 302);
    assert.equal((await live.get('/portal')).status, 200);
    r = await admin.get('/admin/students');
    const token = admin.csrf(r.text_);
    await admin.post(`/admin/students/${u.id}/toggle`, { _csrf: token });
    assert.equal((await live.get('/portal')).status, 302, 'existing session stops working');
    const c = new Client(base);
    r = await c.get('/login');
    r = await c.post('/login', { _csrf: c.csrf(r.text_), email: 'pat@example.com', password: 'another-long-password-2' });
    assert.equal(r.status, 401);
  });

  await ok('passwords are stored hashed', async () => {
    const rows = await db.query('SELECT password_hash FROM users WHERE password_hash IS NOT NULL');
    assert.ok(rows.length >= 2);
    rows.forEach((x) => assert.match(x.password_hash, /^\$2[aby]\$12\$/));
  });

  await ok('repeated bad logins are rate limited (stored in the database)', async () => {
    const c = new Client(base);
    let last;
    for (let i = 0; i < 14; i++) {
      const page = await c.get('/login');
      last = await c.post('/login', { _csrf: c.csrf(page.text_), email: 'nobody@example.com', password: 'guess-' + i });
      if (last.status === 429) break;
    }
    assert.equal(last.status, 429);
    const n = await db.one("SELECT COUNT(*)::int c FROM rate_limits WHERE key LIKE 'login:%'");
    assert.ok(n.c >= 1);
  });

  await ok('sign-up spam is rate limited', async () => {
    let last;
    for (let i = 0; i < 20; i++) {
      last = await anon.post('/register', { name: 'x' });
      if (last.status === 429) break;
    }
    assert.equal(last.status, 429);
  });

  server.close();
  console.log(`\n${passed} checks passed${process.exitCode ? ', with failures' : ''}.`);
  process.exit(process.exitCode || 0);
})();
