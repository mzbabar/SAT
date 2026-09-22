'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const u = require('../lib/util');
const { csrf, requireLogin } = require('../lib/security');

const router = express.Router();
router.use(csrf);
router.use(requireLogin);

function studentOnly(req, res, next) {
  if (req.user.role !== 'student') return res.redirect('/admin');
  next();
}

async function portalData(userId) {
  const [announcements, materials, messages] = await Promise.all([
    db.query('SELECT * FROM announcements ORDER BY id DESC LIMIT 10'),
    db.query('SELECT * FROM materials ORDER BY sort ASC, id ASC'),
    db.query('SELECT * FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 50', [userId]),
  ]);
  return { announcements, materials, messages };
}

router.get('/', studentOnly, async (req, res) => {
  const data = await portalData(req.user.id);
  res.render('portal/index', { title: 'Student area', ...data, errors: {}, values: {} });
});

router.post('/messages', studentOnly, async (req, res) => {
  const subject = u.cleanText(req.body.subject, 150);
  const body = u.cleanText(req.body.body, 4000);
  const errors = {};
  if (!subject) errors.subject = 'Please add a subject.';
  if (!body) errors.body = 'Please write your message.';
  if (Object.keys(errors).length) {
    const data = await portalData(req.user.id);
    return res.status(422).render('portal/index', { title: 'Student area', ...data, errors, values: { subject, body } });
  }
  await db.run('INSERT INTO messages (user_id, subject, body) VALUES (?, ?, ?)', [req.user.id, subject, body]);
  req.flash('ok', 'Your message was sent to your tutor.');
  res.redirect('/portal#messages');
});

router.get('/account', (req, res) => {
  res.render('portal/account', { title: 'Account', error: null });
});

router.post('/account', async (req, res) => {
  const row = await db.one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  const cur = String(req.body.current || '');
  const pw = String(req.body.password || '');
  const pw2 = String(req.body.password2 || '');
  let error = null;
  if (!row || !row.password_hash || !(await bcrypt.compare(cur, row.password_hash))) error = 'Your current password is not correct.';
  else if (pw.length < 10) error = 'Use at least 10 characters for the new password.';
  else if (pw.length > 200) error = 'That password is too long.';
  else if (pw !== pw2) error = 'The new passwords do not match.';
  if (error) return res.status(422).render('portal/account', { title: 'Account', error });

  // Sign out other devices by bumping session_version, and keep this one signed in.
  const hash = await bcrypt.hash(pw, 12);
  const out = await db.one('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ? RETURNING session_version', [hash, req.user.id]);
  req.session.sv = out.session_version;
  req.flash('ok', 'Password changed.');
  res.redirect('/portal/account');
});

module.exports = router;
