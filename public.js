'use strict';
const express = require('express');
const rl = require('../lib/ratelimit');
const db = require('../lib/db');
const config = require('../lib/config');
const u = require('../lib/util');
const mail = require('../lib/mail');

const router = express.Router();

const CONSENT_VERSION = '2026-09-20';
function smsConsentText() {
  return (
    `I agree that ${config.business.name} may call and text me at the number above, including with automated ` +
    `technology, about my free class registration, class reminders and the SAT/ACT math bootcamp. Consent is not ` +
    `a condition of any purchase. Message frequency varies and message and data rates may apply. Reply STOP to ` +
    `opt out at any time.`
  );
}

async function upcomingSessions() {
  const rows = await db.query(
    `SELECT s.*, (SELECT COUNT(*) FROM leads l WHERE l.class_session_id = s.id)::int AS taken
     FROM class_sessions s WHERE s.active = 1 AND s.starts_at > now() ORDER BY s.starts_at ASC LIMIT 8`
  );
  return rows.map((r) => ({ ...r, label: u.formatSession(r.starts_at), full: r.taken >= r.capacity }));
}

async function renderHome(req, res, extra = {}) {
  const q = req.query || {};
  res.status(extra.status || 200).render('index', {
    title: 'Free Live SAT & ACT Math Class',
    sessions: await upcomingSessions(),
    smsConsentText: smsConsentText(),
    mailEnabled: mail.enabled,
    errors: {},
    values: {},
    utm: {
      utm_source: u.cleanText(q.utm_source, 100),
      utm_medium: u.cleanText(q.utm_medium, 100),
      utm_campaign: u.cleanText(q.utm_campaign, 150),
      utm_content: u.cleanText(q.utm_content, 150),
    },
    ...extra,
  });
}

router.get('/', (req, res) => renderHome(req, res));

const registerLimiter = rl.perRequest({
  name: 'register',
  windowMs: 30 * 60 * 1000,
  limit: 12,
  message: 'Too many sign-ups from this connection. Please wait a little while and try again, or contact us directly.',
});

router.post('/register', registerLimiter, async (req, res) => {
  const b = req.body || {};

  // Honeypot: real people never fill this hidden field. Pretend success to bots.
  if (u.cleanText(b.website, 200)) return res.redirect('/thanks');

  const values = {
    name: u.cleanText(b.name, 100),
    phone: u.cleanText(b.phone, 30),
    email: u.cleanText(b.email, 254).toLowerCase(),
    who: b.who === 'student' ? 'student' : 'parent',
    class_session_id: parseInt(b.class_session_id, 10) || '',
    sms_consent: b.sms_consent ? 1 : 0,
  };
  const utm = {
    utm_source: u.cleanText(b.utm_source, 100),
    utm_medium: u.cleanText(b.utm_medium, 100),
    utm_campaign: u.cleanText(b.utm_campaign, 150),
    utm_content: u.cleanText(b.utm_content, 150),
  };

  const errors = {};
  if (values.name.length < 2) errors.name = 'Please enter your full name.';
  const phone = u.normalizePhone(values.phone);
  if (!phone) errors.phone = 'Please enter a 10-digit US phone number.';
  if (!u.isEmail(values.email)) errors.email = 'Please enter a valid email address.';
  if (!b.confirm_age) errors.confirm_age = 'Please confirm this to continue.';
  if (!b.agree_privacy) errors.agree_privacy = 'Please confirm you have read the Privacy Policy and Terms.';

  const sessions = await upcomingSessions();
  let chosen = null;
  if (sessions.length) {
    chosen = sessions.find((s) => s.id === values.class_session_id);
    if (!chosen) errors.class_session_id = 'Please choose a class date.';
    else if (chosen.full) errors.class_session_id = 'That class is full. Please choose another date.';
  }

  if (Object.keys(errors).length) {
    return await renderHome(req, res, { status: 422, errors, values, utm });
  }

  const now = new Date();
  const consentText = values.sms_consent ? smsConsentText() : 'Email only. Did not agree to calls or texts.';
  const ua = u.cleanText(req.get('user-agent'), 300);
  const existing = await db.one(
    'SELECT id FROM leads WHERE email = ? AND COALESCE(class_session_id, 0) = ?',
    [values.email, chosen ? chosen.id : 0]
  );

  if (existing) {
    await db.run(
      'UPDATE leads SET name = ?, phone = ?, who = ?, sms_consent = ?, consent_text = ?, consent_version = ?, consent_at = ?, consent_ip = ?, user_agent = ? WHERE id = ?',
      [values.name, phone, values.who, values.sms_consent, consentText, CONSENT_VERSION, now, req.ip, ua, existing.id]
    );
  } else {
    await db.insert(
      `INSERT INTO leads (name, phone, email, who, class_session_id, sms_consent, consent_text, consent_version,
        consent_at, consent_ip, user_agent, utm_source, utm_medium, utm_campaign, utm_content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        values.name, phone, values.email, values.who, chosen ? chosen.id : null, values.sms_consent,
        consentText, CONSENT_VERSION, now, req.ip, ua,
        utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_content,
      ]
    );
  }

  // Email confirmation (only when SMTP is configured). On serverless hosts the function stops once the
  // response is sent, so we wait for it here; it has short timeouts and never throws.
  await mail.sendClassConfirmation({ name: values.name, email: values.email }, chosen, chosen && chosen.label);

  res.redirect(chosen ? `/thanks?s=${chosen.id}` : '/thanks');
});

router.get('/thanks', async (req, res) => {
  const id = parseInt(req.query.s, 10);
  let cls = null;
  if (id) {
    const row = await db.one('SELECT * FROM class_sessions WHERE id = ?', [id]);
    if (row) cls = { ...row, label: u.formatSession(row.starts_at) };
  }
  res.render('thanks', { title: "You're registered", cls, trackLead: true, mailEnabled: mail.enabled });
});

router.get('/class/:id.ics', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = id ? await db.one('SELECT * FROM class_sessions WHERE id = ?', [id]) : null;
  if (!row) return res.status(404).render('error', { title: 'Not found', message: 'We could not find that class.' });
  const start = new Date(row.starts_at);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const desc = `Free live SAT/ACT math class with ${config.business.tutorName}.${row.zoom_url ? ' Join: ' + row.zoom_url : ''}`.replace(/\n/g, ' ');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SAT ACT Math Class//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:class-${row.id}@${new URL(config.siteUrl).hostname}`,
    `DTSTAMP:${u.icsDate(new Date())}`,
    `DTSTART:${u.icsDate(start)}`,
    `DTEND:${u.icsDate(end)}`,
    `SUMMARY:${row.title}`,
    `DESCRIPTION:${desc.replace(/[,;]/g, (c) => '\\' + c)}`,
    row.zoom_url ? `LOCATION:${row.zoom_url}` : 'LOCATION:Zoom (link in your confirmation)',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  res.type('text/calendar').set('Content-Disposition', `attachment; filename="class-${row.id}.ics"`).send(ics);
});

router.get('/enroll', (req, res) => res.render('enroll', { title: 'SAT/ACT Math Bootcamp' }));
router.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy Policy' }));
router.get('/terms', (req, res) => res.render('terms', { title: 'Terms of Service' }));
router.get('/refund-policy', (req, res) => res.render('refund', { title: 'Refund Policy' }));
router.get('/data-deletion', (req, res) => res.render('data-deletion', { title: 'Data Deletion and Privacy Requests' }));
router.get('/contact', (req, res) => res.render('contact', { title: 'Contact Us' }));

module.exports = router;
module.exports.smsConsentText = smsConsentText;
