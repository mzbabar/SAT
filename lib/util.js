'use strict';
const crypto = require('crypto');
const config = require('./config');

const tz = config.timezone;

function tzOffsetMs(ts, zone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

// "2026-10-04T19:00" entered in the business time zone -> ISO string in UTC.
function zonedToUtc(local, zone = tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || '');
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const off1 = tzOffsetMs(guess, zone);
  let utc = guess - off1;
  const off2 = tzOffsetMs(utc, zone);
  if (off2 !== off1) utc = guess - off2;
  const d = new Date(utc);
  return isNaN(d) ? null : d.toISOString();
}

function toDate(v) {
  if (v instanceof Date) return v;
  if (v == null || v === '') return null;
  const s = String(v);
  const d = new Date(/Z|[+-]\d\d(:?\d\d)?$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? null : d;
}

function formatSession(v) {
  const d = toDate(v);
  if (!d) return '';
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
  return `${s} ${config.tzLabel}`;
}

function formatDateTime(v) {
  const d = toDate(v);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
}

function formatDate(v) {
  const d = toDate(v);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

function icsDate(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}
function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function isEmail(v) {
  return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
}

// US phone numbers: returns "(555) 555-1234" or null.
function normalizePhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return null;
  if (d[0] === '0' || d[0] === '1') return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // avoid spreadsheet formula injection
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function isHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (_) { return false; }
}

module.exports = {
  toDate, zonedToUtc, formatSession, formatDateTime, formatDate, icsDate,
  newToken, hashToken, cleanText, isEmail, normalizePhone, csvCell, isHttpUrl,
};
