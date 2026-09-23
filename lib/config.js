'use strict';
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ quiet: true });

const env = process.env;
const isProd = env.NODE_ENV === 'production';

const PLACEHOLDERS = {
  name: 'Your Business Name',
  tutorName: 'Your Name',
  email: 'you@example.com',
  phone: '(555) 555-5555',
  address: '123 Main Street, City, ST 00000',
};

let sessionSecret = env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) {
    console.error('FATAL: SESSION_SECRET must be set in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
}

const config = {
  isProd,
  port: parseInt(env.PORT || '3000', 10),
  siteUrl: (env.SITE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')).replace(/\/+$/, ''),
  sessionSecret,
  dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'), // only used by the local PGlite fallback
  databaseUrl: env.DATABASE_URL || env.POSTGRES_URL || '',
  timezone: env.TIMEZONE || 'America/New_York',
  tzLabel: env.TIMEZONE_LABEL || 'ET',
  business: {
    name: env.BUSINESS_NAME || PLACEHOLDERS.name,
    tutorName: env.TUTOR_NAME || PLACEHOLDERS.tutorName,
    tutorCredentials: env.TUTOR_CREDENTIALS || 'B.S. Electrical Engineering, University of Engineering & Technology, Lahore · MBA, Old Dominion University',
    tutorBio:
      env.TUTOR_BIO ||
      "I'm an engineer by training, with an MBA, and I have spent more than 15 years tutoring, with over 1,500 hours of one-on-one instruction across academic coursework and standardized test prep. My approach is simple: real practice problems, clear step-by-step explanations, and enough patience to make sure a concept actually sticks before we move on. That is the same method behind this SAT/ACT math class and bootcamp.",
    email: env.CONTACT_EMAIL || PLACEHOLDERS.email,
    phone: env.CONTACT_PHONE || PLACEHOLDERS.phone,
    address: env.BUSINESS_ADDRESS || PLACEHOLDERS.address,
  },
  // Independently verifiable tutoring track record (optional; leave TUTOR_RATING_VALUE blank to hide the badge).
  // This reflects the tutor's overall Wyzant history across all subjects, not SAT/ACT-specific reviews, so the
  // site never implies a review is about SAT/ACT math when it is not.
  tutorRating: {
    value: env.TUTOR_RATING_VALUE || '4.8',
    count: env.TUTOR_RATING_COUNT || '499',
    hours: env.TUTOR_RATING_HOURS || '1,500',
    url: env.TUTOR_RATING_URL || 'https://www.wyzant.com/match/tutor/81419010/',
    source: env.TUTOR_RATING_SOURCE || 'Wyzant',
  },
  bootcamp: {
    price: parseInt(env.BOOTCAMP_PRICE || '299', 10),
    capacity: parseInt(env.BOOTCAMP_CAPACITY || '15', 10),
    dates: env.BOOTCAMP_DATES || 'The next Saturday and Sunday dates are announced at the end of each free class.',
    sessionMinutes: parseInt(env.BOOTCAMP_SESSION_MINUTES || '120', 10), // per day, on Saturday and on Sunday
  },
  stripeLink: env.STRIPE_PAYMENT_LINK || '',
  pixelId: (env.META_PIXEL_ID || '').replace(/[^0-9]/g, ''),
  admin: {
    email: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: env.ADMIN_PASSWORD || '',
  },
  privacyUpdated: env.POLICY_UPDATED || 'September 20, 2026',
  // Appended as ?v=... to /css/style.css and /js/app.js so browsers fetch fresh copies after every deploy,
  // instead of reusing a cached (possibly stale/broken) copy from an earlier deployment for up to 7 days.
  assetVersion: env.VERCEL_GIT_COMMIT_SHA || env.RENDER_GIT_COMMIT || String(Date.now()),
};

// Settings the owner still needs to fill in; shown as a warning in the admin area.
config.missingSettings = () => {
  const out = [];
  const b = config.business;
  if (b.name === PLACEHOLDERS.name) out.push('BUSINESS_NAME');
  if (b.tutorName === PLACEHOLDERS.tutorName) out.push('TUTOR_NAME');
  if (b.email === PLACEHOLDERS.email) out.push('CONTACT_EMAIL');
  if (b.phone === PLACEHOLDERS.phone) out.push('CONTACT_PHONE');
  if (b.address === PLACEHOLDERS.address) out.push('BUSINESS_ADDRESS');
  if (!config.stripeLink) out.push('STRIPE_PAYMENT_LINK');
  if (!config.pixelId) out.push('META_PIXEL_ID');
  if (config.isProd && !/^https:/.test(config.siteUrl)) out.push('SITE_URL (must start with https://)');
  if (config.isProd && !config.databaseUrl) out.push('DATABASE_URL');
  return out;
};

module.exports = config;
