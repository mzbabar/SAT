'use strict';
const express = require('express');
const cookieSession = require('cookie-session');
const helmet = require('helmet');

const config = require('./lib/config');
const db = require('./lib/db');
const util = require('./lib/util');
const views = require('./lib/views');
const { sameOrigin } = require('./lib/security');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Vercel (and most hosts) sit behind a proxy: needed for HTTPS detection and the visitor's IP address.
  if (config.isProd) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://connect.facebook.net'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https://www.facebook.com'],
          connectSrc: ["'self'", 'https://www.facebook.com', 'https://connect.facebook.net'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      // The default (no-referrer) makes browsers send "Origin: null" on form posts, so use a normal policy.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  app.use(express.urlencoded({ extended: false, limit: '30kb' }));
  // Static files live in /public. On Vercel they are served by the CDN before this app runs;
  // this line serves them when running locally.
  app.use(express.static(require('path').join(__dirname, 'public'), { maxAge: config.isProd ? '7d' : 0 }));

  // Sessions are signed cookies (no server-side session storage), so they work on serverless hosts.
  app.use(
    cookieSession({
      name: 'sid',
      keys: [config.sessionSecret],
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      signed: true,
    })
  );

  app.use(views.middleware);

  // Make sure the database tables exist (runs once per server instance).
  app.use(async (req, res, next) => {
    if (req.path === '/health') return next();
    try {
      await db.ready();
      next();
    } catch (e) {
      console.error('Database not ready:', e.message);
      res.status(503).type('text').send('The site is starting up. Please refresh in a few seconds.');
    }
  });

  // Load the logged-in user, if any. A password change or deactivation bumps session_version,
  // which signs the person out everywhere.
  app.use(async (req, res, next) => {
    req.user = null;
    const s = req.session;
    if (s && s.userId) {
      const u = await db.one('SELECT id, email, name, role, active, session_version FROM users WHERE id = ?', [s.userId]);
      if (u && u.active && u.session_version === s.sv) req.user = u;
      else { delete s.userId; delete s.sv; }
    }
    next();
  });

  // Template locals.
  app.use((req, res, next) => {
    res.locals.biz = config.business;
    res.locals.cfg = config;
    res.locals.user = req.user;
    res.locals.path = req.path;
    res.locals.util = util;
    res.locals.pixelId = config.pixelId;
    res.locals.csrfToken = '';
    res.locals.title = '';
    res.locals.flash = null;
    if (req.session && req.session.flash) {
      res.locals.flash = req.session.flash;
      delete req.session.flash;
    }
    req.flash = (type, message) => { req.session.flash = { type, message }; };
    next();
  });

  app.use(sameOrigin); // after locals so the error page can render

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(
      `User-agent: *\nDisallow: /admin\nDisallow: /portal\nDisallow: /login\nDisallow: /setup\nSitemap: ${config.siteUrl}/sitemap.xml\n`
    );
  });
  app.get('/sitemap.xml', (req, res) => {
    const urls = ['/', '/enroll', '/privacy', '/terms', '/refund-policy', '/data-deletion', '/contact'];
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        urls.map((u) => `  <url><loc>${config.siteUrl}${u}</loc></url>`).join('\n') +
        `\n</urlset>\n`
    );
  });

  app.use(require('./routes/public'));
  app.use(require('./routes/auth'));
  app.use('/portal', require('./routes/portal'));
  app.use('/admin', require('./routes/admin'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Page not found', message: 'We could not find that page.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).render('error', { title: 'Something went wrong', message: 'Something went wrong on our side. Please try again in a moment.' });
  });

  return app;
}

const app = createApp();

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Site running at ${config.siteUrl} (port ${config.port})`);
    const missing = config.missingSettings();
    if (missing.length) console.log('Settings still to fill in:', missing.join(', '));
  });
}

// Vercel imports this file and uses the exported Express app as the request handler.
module.exports = app;
module.exports.createApp = createApp;
