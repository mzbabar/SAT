# SAT/ACT Math Free Class and Bootcamp Website (Vercel + Postgres edition)

A small website for a tutor who runs Facebook and Instagram ads to a free one-hour live class and then sells a bootcamp.

**Free class:** 60 minutes, live on Zoom. **Bootcamp:** $299 per student, two live sessions of 120 minutes each (Saturday and Sunday), about 7 students or more per cohort (about $2,000), room for 15.

This edition is built for serverless hosting on **Vercel**. Vercel cannot keep files between requests, so:

- data lives in a hosted **Postgres** database (a free Neon database works),
- logins use signed cookies instead of server-side session files,
- the page templates are bundled into `lib/views.generated.js` at build time.

The same code also runs on any Node host (Render, Railway, Fly.io) if you give it a `DATABASE_URL`.

## Important: Vercel's free (Hobby) plan is for non-commercial use

Vercel's terms limit the free Hobby plan to personal, non-commercial projects. A site that advertises and sells a paid bootcamp is a commercial use, so the plan to use for the real business is **Vercel Pro** (paid, per user per month). Check the current wording at https://vercel.com/docs/limits/fair-use-guidelines before you decide. The free Hobby plan is fine for trying the site out and showing it to friends.

If you need a free host for a real business, this same code runs on Render's free web service with a free Neon database. The trade-off there is that the site sleeps after 15 minutes without visitors and takes about a minute to wake up, which is bad for ad traffic.

## What is included

| Page | What it does |
| --- | --- |
| `/` | Landing page for the ads. Sign-up form: name, phone, email, class date, required age/parent confirmation and privacy checkbox, optional call/text consent. |
| `/thanks` | Confirmation with Zoom link and calendar file. Fires the Meta "Lead" event (only if the visitor accepted cookies). |
| `/enroll` | Bootcamp details with a "Enroll now" button that opens your Stripe Payment Link. |
| `/privacy`, `/terms`, `/refund-policy`, `/data-deletion`, `/contact` | Policies and business contact details that Meta checks before approving ads. |
| `/login` | Student login. Students get a one-time link from you to create a password. |
| `/portal` | Student area: announcements, materials and links, and a private "share with your tutor" message box with replies. |
| `/admin` | Your dashboard: leads (search, status, notes, CSV download), class dates and Zoom links, students, messages, and student-area content. |

## Deploy to Vercel (about 20 minutes)

1. **Put the files on GitHub.** Create a free GitHub account, make a new **private** repository, and upload everything in this folder (on github.com choose "Add file > Upload files" and drag the folder contents in). Do not upload `node_modules` or a `.env` file.
2. **Import into Vercel.** At vercel.com choose Add New > Project, pick the repository, and leave the settings as they are. Vercel detects Express automatically and deploys right away. That first deploy will show an error page until you finish steps 3 and 4, which is expected.
3. **Add the database.** In the Vercel project open the **Storage** tab, choose **Create Database > Neon (Postgres)**, pick the free plan and the region closest to your students (US East works well with Vercel's default region), and connect it to the project. Vercel adds `DATABASE_URL` and `POSTGRES_URL` for you. The site creates its own tables on first visit.
4. **Set the environment variables.** In Settings > Environment Variables add the ones from `.env.example`. The must-haves are:
   - `SESSION_SECRET`: a long random string. Make one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` or any password generator (40+ characters).
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD` (10+ characters): your admin login. It is created the first time the site starts. Changing these variables later does not change an existing admin account; use the Password link in the top menu to change it.
   - `SITE_URL`: your final address, for example `https://www.yourdomain.com` (until then the `.vercel.app` address works).
   - `BUSINESS_NAME`, `TUTOR_NAME`, `TUTOR_BIO`, `CONTACT_EMAIL`, `CONTACT_PHONE`, `BUSINESS_ADDRESS`: shown on the site and in the privacy policy. Meta checks these, so use real details.
   - Optional: `STRIPE_PAYMENT_LINK`, `META_PIXEL_ID`, `BOOTCAMP_DATES`, and the `SMTP_*` settings for confirmation emails.
5. **Deploy** (Deployments > Redeploy, or push any change). Open `/login` and sign in with your admin email and password. The dashboard lists any settings still to fill in.
6. **Add your first class** under Class dates, with its Zoom link.
7. **Custom domain.** In Settings > Domains add your domain and follow the DNS steps. HTTPS is issued automatically. Then update `SITE_URL` and redeploy.

Notes:

- **First visit after a quiet period** can take an extra second while the free Neon database wakes up (it pauses after 5 minutes of no use). Visitors just see a slightly slower first page.
- **Free Neon limits**: 0.5 GB of storage and a monthly compute allowance, which is far more than a lead list and a few students need. Check Neon's current limits and turn on its backups or export your leads (Admin > Leads > Download CSV) regularly.
- **Email confirmations** need an SMTP provider (Brevo, Mailgun, Gmail app password, and so on). Without one, people see the Zoom link on the thank-you page and you copy student login links by hand.

## Run it on your computer

```bash
npm install
cp .env.example .env      # then edit .env (leave DATABASE_URL empty for a built-in test database)
npm start                 # http://localhost:3000
npm test                  # end-to-end checks (27) using an in-memory test database
```

Page templates are read from `views/` while you develop, so edits show up on refresh. Before you deploy, run `npm run build:views` (Vercel also runs it for you through `npm run build`) so `lib/views.generated.js` matches the templates.

To run the checks against a real Postgres server (this erases that database):

```bash
TEST_DATABASE_URL=postgres://user@localhost:5432/scratch DATABASE_SSL=false npm run test:pg
```

## Before you run ads (checklist)

1. Set the business name, address, email and phone. The dashboard warns you until they are real.
2. Have an attorney review `/privacy`, `/terms` and `/refund-policy` for your state. They are plain-language templates, not legal advice. Edit the wording in `views/privacy.ejs`, `views/terms.ejs` and `views/refund.ejs` and the "last updated" date (`POLICY_UPDATED`), then run `npm run build:views` and redeploy.
3. In Meta Business Settings, verify your domain, add your payment method, and create a Pixel. Paste the Pixel ID into `META_PIXEL_ID`. The pixel loads only after a visitor clicks Accept on the cookie banner.
4. Submit a test registration on the live site and confirm you see it under Leads.
5. Make a Stripe Payment Link for the bootcamp and set `STRIPE_PAYMENT_LINK`.
6. Ads should only promise what the landing page delivers: a free live class. Do not promise score increases. Do not write copy that implies you know something about the viewer (for example "Is your child failing math?").
7. If you text people, register your business with your text-message provider (A2P 10DLC) and only text leads marked **Text OK**.

## How enrollment works day to day

1. Someone registers. You see them under Leads. If SMTP is configured they get a confirmation email; otherwise they see the Zoom link on the thank-you page.
2. After the class, mark attendees as **attended**.
3. When someone pays, click **Enroll + login** on their lead. It marks them enrolled and creates a one-time password link (emailed if SMTP is set, otherwise copy and send it yourself).
4. Post Zoom links and materials under "Student area content". Answer student messages under Messages.

## Security notes

- Passwords are hashed with bcrypt. Login sessions are signed, HTTP-only, secure cookies that expire after 7 days. Changing a password or deactivating a student signs that person out everywhere. Visitors who are not logging in receive no cookies.
- Every logged-in form uses a CSRF token, and cross-site posts are blocked. Login, password setup and sign-up are rate limited (counted in the database, so it works across Vercel's many small servers). The sign-up form has a hidden bot trap.
- A strict Content Security Policy is on. Only the Meta Pixel script host is allowed besides your own site.
- Set a long random `SESSION_SECRET` and a strong `ADMIN_PASSWORD`. Changing `SESSION_SECRET` signs everyone out. Never commit `.env`.

## Project layout

```
server.js               app setup and security headers; exports the Express app (Vercel runs it)
lib/                    config, database (Postgres), rate limiting, security, email, helpers, page rendering
lib/views.generated.js  templates bundled by "npm run build:views" (generated, do not edit)
routes/                 public.js, auth.js, portal.js, admin.js
views/                  EJS pages (policies are in privacy.ejs, terms.ejs, refund.ejs)
public/                 CSS, JavaScript, favicon (served by Vercel's CDN)
scripts/build-views.js  bundles the templates
test/smoke.test.js      end-to-end tests
```

## Not tested on real Vercel yet

The automated checks run the site against embedded Postgres and against a real Postgres 16 server with the same database driver Vercel uses, in production mode and with the `views` folder removed. It has not been deployed to a live Vercel account, so do the deploy steps above and click through the site once (sign up, log in as admin, invite a student, log in as the student) before you spend money on ads.
