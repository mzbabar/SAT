'use strict';
const crypto = require('crypto');

// Session-based CSRF token, checked on every state-changing request that uses a session.
function csrf(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  res.locals.csrfToken = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = (req.body && req.body._csrf) || '';
  const a = Buffer.from(String(sent));
  const b = Buffer.from(req.session.csrf);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).render('error', { title: 'Session expired', message: 'Your form session expired. Please go back, refresh the page and try again.' });
  }
  next();
}

// Reject cross-site POSTs by comparing Origin/Referer with the Host header.
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const src = req.get('origin') || req.get('referer');
  if (!src || src === 'null') return next(); // some privacy tools strip both; SameSite cookies + CSRF token still protect logged-in actions
  try {
    if (new URL(src).host !== req.get('host')) {
      return res.status(403).render('error', { title: 'Request blocked', message: 'This request came from another site and was blocked.' });
    }
  } catch (_) {
    return res.status(400).render('error', { title: 'Bad request', message: 'Invalid request.' });
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/login');
    }
    if (req.user.role !== role) {
      return res.status(403).render('error', { title: 'Not allowed', message: 'You do not have access to that page.' });
    }
    next();
  };
}

module.exports = { csrf, sameOrigin, requireLogin, requireRole };
