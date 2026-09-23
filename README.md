# SAT/ACT Math Free Class and Bootcamp Website (Vercel + Postgres edition)

A small website for a tutor who runs Facebook and Instagram ads to a free 40-minute live class and then sells a bootcamp.

**Free class:** 40 minutes, live on Zoom. **Bootcamp:** $299 per student, two live sessions of 120 minutes each (Saturday and Sunday), about 7 students or more per cohort (about $2,000), room for 15.

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

## Deploy to Vercel, step by step (about 20 to 30 minutes)

The example values below (business name, email, password, keys) are placeholders so you can see exactly what goes where. Replace every one of them with your own before you go live — never use the example password or session secret shown here.

### 1. Put the code on GitHub

1. Go to [github.com](https://github.com) and sign up if you don't have an account.
2. Click the **+** in the top right, then **New repository**.
3. Name it something like `bright-path-math-site`, set visibility to **Private**, and leave "Add a README" unchecked (this folder already has one). Click **Create repository**.
4. On the new, empty repository page, click **uploading an existing file**.
5. Open this folder on your computer in Finder or File Explorer, select everything in it **except** the `node_modules` folder, the `data` folder (if present) and any `.env` file, and **drag that whole selection** onto the GitHub upload box. Dragging is important: this folder has subfolders inside subfolders (`views/partials`, `views/admin`, `views/portal`), and GitHub's "choose your files" link opens a picker that can only select individual files, not folders — so subfolders silently get left out if you use it. Dragging preserves the folder structure.
6. Before committing, use the file list GitHub shows you to confirm you see `views/partials`, `views/admin`, and `views/portal` as folders, not just the files directly inside `views`. If any of those three are missing, remove what you added and drag again.
7. Scroll down and click **Commit changes**.

If you'd rather avoid this pitfall entirely, install [GitHub Desktop](https://desktop.github.com), point it at this folder, and publish the repository from there — it uploads the whole folder correctly every time, which also makes it easier to push future edits (like the policy page wording in the pre-launch checklist below).

### 2. Import the project into Vercel

1. Go to [vercel.com](https://vercel.com) and sign up or log in — choosing "Continue with GitHub" is easiest, since it connects your account automatically.
2. On your Vercel dashboard, click **Add New...** in the top right, then **Project**.
3. Under "Import Git Repository," find `bright-path-math-site` (or whatever you named it) and click **Import**.
4. On the "Configure Project" screen:
   - **Framework Preset**: leave it as detected (Vercel recognizes this as a Node/Express app).
   - Expand **Build and Output Settings** and turn on the override for **Build Command**. Enter:
     ```
     npm run build
     ```
     This regenerates the bundled page templates every time you deploy, so an edited privacy policy or price change always makes it live. (The folder you uploaded already has a built copy, so the very first deploy would work either way — this just makes every deploy after that one safe too.)
   - Leave **Output Directory** and **Install Command** as detected.
5. Click **Deploy**. The first deployment will finish but the site will show a "settings still to fill in" or error page when you open it — that's expected, because there's no database or admin login yet. Continue to step 3.

### 3. Add the database (Neon Postgres)

1. Open your new project in Vercel and click the **Storage** tab.
2. Click **Create Database**, then choose **Neon** (listed under Marketplace Database Providers) and click **Continue** or **Install**.
3. Choose **Create New Neon Account** (unless you already have one you want to link), then **Continue**.
4. Accept the terms, choose the **Free** plan, pick the region closest to where your students live (for example, a US region if you're advertising in the US), give the database a name (for example `bright-path-math-db`), and confirm.
5. You'll land back on the **Storage** tab showing the new database's status and connection details.
6. Click into the database, then **Connect Project**. Pick your Vercel project, and check all three environments: **Production**, **Preview**, and **Development**. Click **Connect**.

This step is what creates `DATABASE_URL` for you — see the section below for exactly where to find it and what it looks like. You do not type or paste a database URL by hand for Neon; the integration writes it into your project's environment variables automatically.

### 4. Set the environment variables

Go to your project's **Settings** tab, then **Environment Variables**. `DATABASE_URL` (from step 3) is already listed here, tagged with the Neon integration. Add each of the following: type the **Key** exactly as shown, paste the **Value**, leave all three environment boxes (Production, Preview, Development) checked, and click **Add** after each one.

| Key | Example value (replace with your own) | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | `7970fd7875869ffa93aad5897ca04eab7701e5cc1321b9da0a97cbcde04c2056` | Generate your own random one — see below. Never reuse this example value. |
| `ADMIN_EMAIL` | `owner@brightpathmath.com` | The email you'll use to log in to `/admin`. |
| `ADMIN_PASSWORD` | `BootcampOwner-2026!` | 10+ characters. Created as the admin account the first time the site starts. |
| `SITE_URL` | `https://bright-path-math-site.vercel.app` | Use the `.vercel.app` address Vercel gave your project for now; update this once you add a custom domain (step 7). |
| `BUSINESS_NAME` | `Bright Path Math Tutoring` | Shown across the site and in the privacy policy. |
| `TUTOR_NAME` | `Jordan Ellis` | |
| `TUTOR_BIO` | `Jordan has 8 years of experience tutoring high school math and has helped more than 200 students prepare for the SAT and ACT.` | Only include claims you can back up. |
| `CONTACT_EMAIL` | `hello@brightpathmath.com` | |
| `CONTACT_PHONE` | `(512) 555-0142` | |
| `BUSINESS_ADDRESS` | `482 Maple Street, Austin, TX 78701` | Meta checks that this is a real, working address before approving ads. |
| `BOOTCAMP_DATES` | `Saturday and Sunday, November 14 and 15, 2026` | Optional; shown on the bootcamp page until you add real class dates in step 6. |
| `STRIPE_PAYMENT_LINK` | `https://buy.stripe.com/test_00000001abcXYZ` | Optional at first; create a real one in your Stripe dashboard before you accept payments, and replace this. |
| `META_PIXEL_ID` | `123456789012345` | Optional; from Meta Events Manager. Loads only after a visitor clicks Accept on the cookie banner. |

To generate your own `SESSION_SECRET` instead of the example above, run this on your own computer (with Node installed) and copy the output:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

If you don't have Node handy, any password manager's "generate password" feature set to 40+ characters works just as well.

Optional: the `SMTP_*` variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`) turn on email confirmations. Leave them blank for now if you don't have an email-sending provider yet — the site works fine without them.

#### Where DATABASE_URL comes from, and what it looks like

You never fill this one in yourself when using Neon through Vercel's Storage tab (step 3) — it's set automatically. To see it: **Settings > Environment Variables**, find the row for `DATABASE_URL` (it shows a small Neon/Marketplace tag next to it), and click the eye icon to reveal the value. It will look like this (yours will have different random characters and a different region):

```
postgres://neondb_owner:AbC123xYzPqR7@ep-restless-star-12345678-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
```

If you ever use a Postgres database from somewhere other than Vercel's Neon integration (for example, a Neon account you created directly at neon.tech, or Supabase), there's no automatic step — copy that provider's connection string and add it yourself: **Settings > Environment Variables > Add New**, Key `DATABASE_URL`, Value the connection string, check Production/Preview/Development, then **Save**.

### 5. Redeploy so the new settings take effect

Environment variables only apply to deployments made after you add them. Go to the **Deployments** tab, find the most recent deployment, click the **⋯** menu next to it, and choose **Redeploy**.

### 6. Sign in and add your first class

1. Open `https://bright-path-math-site.vercel.app/login` (use your own project's address) and sign in with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` you set in step 4.
2. The dashboard lists any settings you still need to fill in.
3. Go to **Class dates**, add your first free class with its Zoom link.

### 7. Add your custom domain

1. In Vercel, go to **Settings > Domains**, type your domain (for example `www.brightpathmath.com`), and follow the DNS steps it shows you (usually adding a record at wherever you bought the domain). HTTPS is issued automatically once it's connected.
2. Go back to **Settings > Environment Variables**, edit `SITE_URL` to your real domain (`https://www.brightpathmath.com`), and redeploy (step 5) again.

### Notes

- **First visit after a quiet period** can take an extra second while the free Neon database wakes up (it pauses after 5 minutes of no use). Visitors just see a slightly slower first page.
- **Free Neon limits**: 0.5 GB of storage and a monthly compute allowance, which is far more than a lead list and a few students need. Check Neon's current limits and turn on its backups or export your leads (Admin > Leads > Download CSV) regularly.
- **Email confirmations** need an SMTP provider (Brevo, Mailgun, Gmail app password, and so on). Without one, people see the Zoom link on the thank-you page and you copy student login links by hand.
- **If a deploy fails with "page template(s) are missing from the views folder"**, a subfolder didn't make it into your GitHub repository (see the warning in step 1). The error names exactly which files are missing; add them on GitHub and redeploy.
- **If a page shows the right text but looks unstyled** (no colors, plain serif font, no header bar) right after a redeploy, that's almost always a visitor's browser holding onto a cached copy of an older CSS file — static files are cached for 7 days. The site now appends a version string to `/css/style.css` and `/js/app.js` automatically (based on Vercel's commit hash) so every new deploy gets a fresh, uncached URL and this should no longer happen. If you still see it, do a hard refresh (Safari: hold Option and click Reload, or use a Private window) to confirm it's a cache, not a real deploy problem.

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
