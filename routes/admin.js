'use strict';
const express = require('express');
const db = require('../lib/db');
const config = require('../lib/config');
const u = require('../lib/util');
const mail = require('../lib/mail');
const { csrf, requireRole } = require('../lib/security');

const router = express.Router();
router.use(csrf);
router.use(requireRole('admin'));

const STATUSES = ['registered', 'attended', 'enrolled', 'not_interested'];
const INVITE_DAYS = 7;

router.get('/', async (req, res) => {
  const count = async (sql, p = []) => (await db.one(sql, p)).c;
  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const [leads, week, attended, enrolled, students, unreplied, recent, nextClass] = await Promise.all([
    count('SELECT COUNT(*)::int c FROM leads'),
    count('SELECT COUNT(*)::int c FROM leads WHERE created_at >= ?', [weekAgo]),
    count("SELECT COUNT(*)::int c FROM leads WHERE status = 'attended'"),
    count("SELECT COUNT(*)::int c FROM leads WHERE status = 'enrolled'"),
    count("SELECT COUNT(*)::int c FROM users WHERE role = 'student' AND active = 1"),
    count('SELECT COUNT(*)::int c FROM messages WHERE reply IS NULL'),
    db.query(
      `SELECT l.*, s.starts_at FROM leads l LEFT JOIN class_sessions s ON s.id = l.class_session_id
       ORDER BY l.id DESC LIMIT 8`
    ),
    db.one('SELECT * FROM class_sessions WHERE active = 1 AND starts_at > now() ORDER BY starts_at LIMIT 1'),
  ]);
  const stats = { leads, week, attended, enrolled, students, unreplied };
  res.render('admin/dashboard', { title: 'Dashboard', stats, recent, nextClass, missing: config.missingSettings() });
});

// ---- Leads -----------------------------------------------------------------
async function leadQuery(req) {
  const status = STATUSES.includes(req.query.status) ? req.query.status : '';
  const q = u.cleanText(req.query.q, 100).replace(/[\\%_]/g, (c) => '\\' + c);
  const where = [];
  const params = [];
  if (status) { where.push('l.status = ?'); params.push(status); }
  if (q) { where.push('(l.name ILIKE ? OR l.email ILIKE ? OR l.phone ILIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const sql = `SELECT l.*, s.starts_at, (SELECT id FROM users WHERE lower(email) = lower(l.email) AND role = 'student') AS student_id
    FROM leads l LEFT JOIN class_sessions s ON s.id = l.class_session_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id DESC LIMIT 1000`;
  return { rows: await db.query(sql, params), status, q: u.cleanText(req.query.q, 100) };
}

router.get('/leads', async (req, res) => {
  const { rows, status, q } = await leadQuery(req);
  res.render('admin/leads', { title: 'Leads', leads: rows, status, q, STATUSES });
});

router.get('/leads.csv', async (req, res) => {
  const { rows } = await leadQuery(req);
  const head = ['id', 'created_at', 'name', 'phone', 'email', 'who', 'class', 'status', 'sms_consent', 'consent_at', 'utm_source', 'utm_campaign', 'notes'];
  const lines = [head.join(',')].concat(
    rows.map((r) =>
      [r.id, r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at, r.name, r.phone, r.email, r.who, r.starts_at ? u.formatSession(r.starts_at) : '', r.status, r.sms_consent ? 'yes' : 'no', r.consent_at instanceof Date ? r.consent_at.toISOString() : r.consent_at, r.utm_source, r.utm_campaign, r.notes].map(u.csvCell).join(',')
    )
  );
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="leads.csv"').send(lines.join('\r\n') + '\r\n');
});

const idOf = (req) => parseInt(req.params.id, 10) || 0;

router.post('/leads/:id/status', async (req, res) => {
  const status = STATUSES.includes(req.body.status) ? req.body.status : null;
  if (status) await db.run('UPDATE leads SET status = ? WHERE id = ?', [status, idOf(req)]);
  const back = u.cleanText(req.body.back, 200);
  res.redirect(back.startsWith('/admin') ? back : '/admin/leads');
});

router.post('/leads/:id/notes', async (req, res) => {
  await db.run('UPDATE leads SET notes = ? WHERE id = ?', [u.cleanText(req.body.notes, 1000), idOf(req)]);
  req.flash('ok', 'Note saved.');
  res.redirect('/admin/leads');
});

router.post('/leads/:id/delete', async (req, res) => {
  await db.run('DELETE FROM leads WHERE id = ?', [idOf(req)]);
  req.flash('ok', 'Lead deleted.');
  res.redirect('/admin/leads');
});

// Create (or reset) a student login and show a one-time setup link.
async function issueInvite(userId) {
  const token = u.newToken();
  await db.run('UPDATE users SET invite_token_hash = ?, invite_expires = ? WHERE id = ?', [
    u.hashToken(token),
    new Date(Date.now() + INVITE_DAYS * 864e5),
    userId,
  ]);
  return `${config.siteUrl}/setup/${token}`;
}

router.post('/leads/:id/invite', async (req, res) => {
  const lead = await db.one('SELECT * FROM leads WHERE id = ?', [idOf(req)]);
  if (!lead) return res.redirect('/admin/leads');
  const email = lead.email.toLowerCase();
  let user = await db.one('SELECT * FROM users WHERE email = ?', [email]);
  if (user && user.role !== 'student') {
    req.flash('error', 'That email belongs to an administrator account.');
    return res.redirect('/admin/leads');
  }
  if (!user) {
    const id = await db.insert("INSERT INTO users (email, name, role, lead_id) VALUES (?, ?, 'student', ?)", [email, lead.name, lead.id]);
    user = { id };
  }
  await db.run("UPDATE leads SET status = 'enrolled' WHERE id = ?", [lead.id]);
  const link = await issueInvite(user.id);
  const emailed = await mail.sendStudentInvite({ name: lead.name, email: lead.email }, link, INVITE_DAYS);
  res.render('admin/invite', { title: 'Student login link', studentName: lead.name, email: lead.email, link, days: INVITE_DAYS, emailed });
});

// ---- Class sessions --------------------------------------------------------
router.get('/sessions', async (req, res) => {
  const rows = await db.query(
    `SELECT s.*, (SELECT COUNT(*) FROM leads l WHERE l.class_session_id = s.id)::int AS taken FROM class_sessions s ORDER BY s.starts_at DESC`
  );
  const now = Date.now();
  const sessions = rows.map((s) => ({ ...s, label: u.formatSession(s.starts_at), past: new Date(s.starts_at).getTime() < now }));
  res.render('admin/sessions', { title: 'Class dates', sessions, error: null });
});

router.post('/sessions', async (req, res) => {
  const startsAt = u.zonedToUtc(req.body.starts_at);
  const zoom = u.cleanText(req.body.zoom_url, 500);
  const capacity = Math.min(Math.max(parseInt(req.body.capacity, 10) || 40, 1), 500);
  if (!startsAt) { req.flash('error', 'Please enter a valid date and time.'); return res.redirect('/admin/sessions'); }
  if (zoom && !u.isHttpUrl(zoom)) { req.flash('error', 'The Zoom link must start with https://'); return res.redirect('/admin/sessions'); }
  await db.run('INSERT INTO class_sessions (starts_at, title, zoom_url, capacity) VALUES (?, ?, ?, ?)', [
    startsAt, u.cleanText(req.body.title, 120) || 'Free SAT/ACT Math Class', zoom, capacity,
  ]);
  req.flash('ok', 'Class date added.');
  res.redirect('/admin/sessions');
});

router.post('/sessions/:id/toggle', async (req, res) => {
  await db.run('UPDATE class_sessions SET active = 1 - active WHERE id = ?', [idOf(req)]);
  res.redirect('/admin/sessions');
});

router.post('/sessions/:id/delete', async (req, res) => {
  await db.run('DELETE FROM class_sessions WHERE id = ?', [idOf(req)]);
  req.flash('ok', 'Class date deleted. People who registered for it are kept in Leads.');
  res.redirect('/admin/sessions');
});

// ---- Students --------------------------------------------------------------
router.get('/students', async (req, res) => {
  const students = await db.query("SELECT * FROM users WHERE role = 'student' ORDER BY id DESC");
  res.render('admin/students', { title: 'Students', students });
});

router.post('/students/:id/reset', async (req, res) => {
  const s = await db.one("SELECT * FROM users WHERE id = ? AND role = 'student'", [idOf(req)]);
  if (!s) return res.redirect('/admin/students');
  const link = await issueInvite(s.id);
  const emailed = await mail.sendStudentInvite({ name: s.name, email: s.email }, link, INVITE_DAYS);
  res.render('admin/invite', { title: 'Password reset link', studentName: s.name, email: s.email, link, days: INVITE_DAYS, emailed });
});

router.post('/students/:id/toggle', async (req, res) => {
  // Bumping session_version also signs the student out of every device.
  await db.run("UPDATE users SET active = 1 - active, session_version = session_version + 1 WHERE id = ? AND role = 'student'", [idOf(req)]);
  res.redirect('/admin/students');
});

router.post('/students/:id/delete', async (req, res) => {
  await db.run("DELETE FROM users WHERE id = ? AND role = 'student'", [idOf(req)]);
  req.flash('ok', 'Student account and messages deleted.');
  res.redirect('/admin/students');
});

// ---- Messages --------------------------------------------------------------
router.get('/messages', async (req, res) => {
  const messages = await db.query(
    'SELECT m.*, u.name, u.email FROM messages m JOIN users u ON u.id = m.user_id ORDER BY (m.reply IS NULL) DESC, m.id DESC LIMIT 200'
  );
  res.render('admin/messages', { title: 'Student messages', messages });
});

router.post('/messages/:id/reply', async (req, res) => {
  const reply = u.cleanText(req.body.reply, 4000);
  if (reply) {
    await db.run('UPDATE messages SET reply = ?, replied_at = now() WHERE id = ?', [reply, idOf(req)]);
    req.flash('ok', 'Reply saved. The student will see it in their student area.');
  }
  res.redirect('/admin/messages');
});

// ---- Content for the student area -----------------------------------------
router.get('/content', async (req, res) => {
  const [materials, announcements] = await Promise.all([
    db.query('SELECT * FROM materials ORDER BY sort ASC, id ASC'),
    db.query('SELECT * FROM announcements ORDER BY id DESC'),
  ]);
  res.render('admin/content', { title: 'Student area content', materials, announcements });
});

router.post('/materials', async (req, res) => {
  const title = u.cleanText(req.body.title, 150);
  const url = u.cleanText(req.body.url, 800);
  if (!title || !u.isHttpUrl(url)) { req.flash('error', 'Add a title and a link that starts with https://'); return res.redirect('/admin/content'); }
  await db.run('INSERT INTO materials (title, description, url, sort) VALUES (?, ?, ?, ?)', [
    title, u.cleanText(req.body.description, 400), url, parseInt(req.body.sort, 10) || 0,
  ]);
  req.flash('ok', 'Material added.');
  res.redirect('/admin/content');
});

router.post('/materials/:id/delete', async (req, res) => {
  await db.run('DELETE FROM materials WHERE id = ?', [idOf(req)]);
  res.redirect('/admin/content');
});

router.post('/announcements', async (req, res) => {
  const title = u.cleanText(req.body.title, 150);
  const body = u.cleanText(req.body.body, 3000);
  if (!title || !body) { req.flash('error', 'Add a title and a message.'); return res.redirect('/admin/content'); }
  await db.run('INSERT INTO announcements (title, body) VALUES (?, ?)', [title, body]);
  req.flash('ok', 'Announcement posted.');
  res.redirect('/admin/content');
});

router.post('/announcements/:id/delete', async (req, res) => {
  await db.run('DELETE FROM announcements WHERE id = ?', [idOf(req)]);
  res.redirect('/admin/content');
});

module.exports = router;
