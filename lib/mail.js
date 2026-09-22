'use strict';
// Optional email. Set SMTP_HOST, SMTP_USER, SMTP_PASS (and MAIL_FROM) to turn it on.
// Without SMTP settings the site still works: the Zoom link is shown on the confirmation page
// and the admin can copy student login links by hand.
const nodemailer = require('nodemailer');
const config = require('./config');

const env = process.env;
const enabled = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

let transport = null;
if (enabled) {
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: parseInt(env.SMTP_PORT || '587', 10),
    secure: env.SMTP_SECURE === 'true',
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    // Serverless functions are short-lived, so never wait long on a mail server.
    connectionTimeout: 6000,
    greetingTimeout: 6000,
    socketTimeout: 8000,
  });
}

const from = env.MAIL_FROM || `${config.business.name} <${config.business.email}>`;

async function send({ to, subject, text }) {
  if (!enabled) return false;
  try {
    await transport.sendMail({
      from, to, subject, text,
      replyTo: config.business.email,
    });
    return true;
  } catch (err) {
    console.error('Email failed:', err.message);
    return false;
  }
}

function footer() {
  return `\n\n--\n${config.business.name}\n${config.business.address}\n${config.business.email}\nPrivacy Policy: ${config.siteUrl}/privacy`;
}

function sendClassConfirmation(lead, cls, label) {
  if (!cls) {
    return send({
      to: lead.email,
      subject: `You're on the list for the free SAT/ACT math class`,
      text: `Hi ${lead.name},\n\nThanks for signing up. We are scheduling the next free class and will email you as soon as the date is set.${footer()}`,
    });
  }
  return send({
    to: lead.email,
    subject: `Your free SAT/ACT math class: ${label}`,
    text:
      `Hi ${lead.name},\n\nYou're registered for the free SAT/ACT math class.\n\n` +
      `When: ${label}\n` +
      (cls.zoom_url ? `Join on Zoom: ${cls.zoom_url}\n` : 'Your Zoom link will be emailed before class.\n') +
      `Add to your calendar: ${config.siteUrl}/class/${cls.id}.ics\n\n` +
      `Bring pencil and paper and one or two problems you find hard.\n\n` +
      `If you can no longer attend, just reply to this email.${footer()}`,
  });
}

function sendStudentInvite(student, link, days) {
  return send({
    to: student.email,
    subject: `Set up your student login for ${config.business.name}`,
    text:
      `Hi ${student.name},\n\nWelcome. Use this link to create your password and open the student area:\n\n${link}\n\n` +
      `The link works for ${days} days and can be used once.${footer()}`,
  });
}

module.exports = { enabled, send, sendClassConfirmation, sendStudentInvite };
