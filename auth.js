'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const u = require('../lib/util');
const rl = require('../lib/ratelimit');
const { csrf } = require('../lib/security');

const router = express.Router();
router.use(['/login', '/logout', '/setup'], csrf);

// Used so unknown emails take as long to reject as real ones (a bcrypt hash of a random string, cost 12).
const DUMMY_HASH = '$2b$12$CtHy0Zxahc.EoMTud2olYOiT0I7HqIBinRs6aNb4VHl6mVG5F8RRy';

const LOGIN_WINDOW = 15 * 60 * 1000;
const loginGuard = rl.perFailure({
  name: 'login',
  windowMs: LOGIN_WINDOW,
  limit: 10,
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
});
const setupGuard = rl.perRequest({
  name: 'setup',
  windowMs: LOGIN_WINDOW,
  limit: 20,
  message: 'Too many attempts. Please wait 15 minutes and try again.',
});

function safeReturnTo(p) {
  return typeof p === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(p) ? p : null;
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : '/portal');
  res.render('login', { title: 'Student login', error: null, email: '' });
});

router.post('/login', loginGuard, async (req, res) => {
  const email = u.cleanText(req.body.email, 254).toLowerCase();
  const password = String(req.body.password || '').slice(0, 200);

  // Also limit repeated failures against one email address, no matter where they come from.
  if (email && (await req.rateBlockedFor(`email:${email}`))) {
    return res.status(429).render('error', { title: 'Too many attempts', message: 'Too many login attempts. Please wait 15 minutes and try again.' });
  }

  const user = await db.one('SELECT * FROM users WHERE email = ?', [email]);
  const ok = await bcrypt.compare(password, user && user.password_hash ? user.password_hash : DUMMY_HASH);
  if (!user || !user.password_hash || !user.active || !ok) {
    await req.recordFailure(email ? `email:${email}` : null);
    return res.status(401).render('login', { title: 'Student login', error: 'Incorrect email or password.', email });
  }

  const returnTo = safeReturnTo(req.session.returnTo);
  // Start a brand-new session at login (prevents session fixation).
  req.session = { userId: user.id, sv: user.session_version };
  await db.run('UPDATE users SET last_login = now() WHERE id = ?', [user.id]);
  const dest =
    user.role === 'admin'
      ? returnTo && returnTo.startsWith('/admin') ? returnTo : '/admin'
      : returnTo && returnTo.startsWith('/portal') ? returnTo : '/portal';
  res.redirect(dest);
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

// Invite / password reset link created by the admin.
function findByToken(token) {
  return db.one(
    'SELECT * FROM users WHERE invite_token_hash = ? AND invite_expires > now() AND active = 1',
    [u.hashToken(String(token || ''))]
  );
}

const EXPIRED = { title: 'Link expired', message: 'This link has expired or was already used. Please ask your tutor to send a new one.' };

router.get('/setup/:token', async (req, res) => {
  const user = await findByToken(req.params.token);
  if (!user) return res.status(410).render('error', EXPIRED);
  res.render('setup', { title: 'Create your password', student: user, error: null, token: req.params.token });
});

router.post('/setup/:token', setupGuard, async (req, res) => {
  const user = await findByToken(req.params.token);
  if (!user) return res.status(410).render('error', EXPIRED);
  const pw = String(req.body.password || '');
  const pw2 = String(req.body.password2 || '');
  let error = null;
  if (pw.length < 10) error = 'Use at least 10 characters.';
  else if (pw.length > 200) error = 'That password is too long.';
  else if (pw.toLowerCase() === user.email) error = 'Your password cannot be your email address.';
  else if (pw !== pw2) error = 'The two passwords do not match.';
  if (error) return res.status(422).render('setup', { title: 'Create your password', student: user, error, token: req.params.token });

  // Bumping session_version signs the account out of every device.
  const hash = await bcrypt.hash(pw, 12);
  await db.run(
    'UPDATE users SET password_hash = ?, invite_token_hash = NULL, invite_expires = NULL, session_version = session_version + 1 WHERE id = ?',
    [hash, user.id]
  );
  req.flash('ok', 'Your password is set. Please log in.');
  res.redirect('/login');
});

module.exports = router;
