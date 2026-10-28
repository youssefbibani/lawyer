# Deploying to Vercel

How to host قصر العدالة on [Vercel](https://vercel.com) with a free [Neon](https://neon.tech) PostgreSQL
database. Allow about 20 minutes the first time.

> **Before you start.** The project's API used to be an ordinary Node server, and Vercel needs it as a
> serverless function. The small code changes that make this work are **already in the repository**; they are
> listed, file by file, in **[DEPLOY_VERCEL_CODE_CHANGES.md](DEPLOY_VERCEL_CODE_CHANGES.md)** for reference.
> This guide has not yet been run end to end on a real Vercel account; the code changes were checked locally,
> and that page says exactly how.

```
Browser ──► Vercel ──┬─ static web app (the built React SPA)
                     └─ /api/*  → one serverless function (the Hono API)  ──► Neon PostgreSQL
```

The web app and the API share one address, so sign-in cookies stay first-party and nothing needs CORS.

---

## 0. Read this first: what works and what does not

| Feature | On Vercel |
|---|---|
| Sign-in, sessions, two-factor, password change | Works |
| Dashboard, clients, cases, hearings, calendar, tasks, fees, payments, settings, members, audit log | Works |
| Assistant, smart archive, approvals (the browser-side demo modules) | Works, exactly as before |
| **Reminders** (in-app and e-mail) | **Needs a schedule — see [step 7](#7-turn-on-reminders).** Without one, nothing is delivered. |
| **PDF receipts** | **Not generated.** The payment and its receipt number are still recorded and shown; the PDF is reported as "not generated" with a retry button. See [PDF receipts](#8-pdf-receipts). |
| Password-reset and reminder e-mails | Only if you set `SMTP_URL` |

If receipts as PDF files or timely reminders are essential **and** you do not want to arrange them as
described below, host the API with the included `Dockerfile` instead (see
[README_BACKEND.md](../README_BACKEND.md#8-deployment)).

---

## 1. Create the database (Neon)

1. Sign up at https://neon.tech (free) and create a project. Pick the region closest to your Vercel region
   (Vercel's default is Washington, D.C.; Neon offers `us-east-2`, `eu-central-1`, …).
2. In the project's **Connection details** copy **two** connection strings:
   - **Pooled** (the host contains `-pooler`) — used by the running app.
   - **Direct / unpooled** (no `-pooler`) — used only to apply database migrations.
3. For the pooled one, append `&pgbouncer=true&connect_timeout=15` so Prisma works through the pooler:

   ```
   postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=15
   ```

The database extension this app needs (`pg_trgm`) is created by the first migration; Neon allows it.

> Neon's Vercel integration can create these variables for you (Vercel → Storage → Create → Neon). It names
> them `DATABASE_URL` and `DATABASE_URL_UNPOOLED`, which is what this project reads. If you use it, still
> append the `pgbouncer` parameters to `DATABASE_URL` yourself, or paste the strings by hand as above.

## 2. Put the code on GitHub

Vercel builds from your repository, so the changes from
[DEPLOY_VERCEL_CODE_CHANGES.md](DEPLOY_VERCEL_CODE_CHANGES.md) (new `vercel.json`, `api/index.js`, … and short
edits to a few files) must be in the commit on `main` that Vercel builds. They are applied in this repository;
make sure that commit is pushed. Until `vercel.json` and `api/index.js` are in the pushed commit, the steps
below will not work.

## 3. Import the project in Vercel

1. Vercel dashboard → **Add New… → Project** → pick your GitHub repository.
2. Leave **Framework Preset** as *Vite* and every build setting as it is: `vercel.json` already defines them.
3. **Do not press Deploy yet.** Open **Environment Variables** first (next step).

## 4. Environment variables

Add these for the **Production** environment (tick Preview too only if you want previews to use the same
database — see [Previews](#9-preview-deployments)).

| Name | Value | Required |
|---|---|:-:|
| `DATABASE_URL` | the **pooled** string from step 1, with `&pgbouncer=true&connect_timeout=15` | yes |
| `DATABASE_URL_UNPOOLED` | the **direct** string from step 1 | yes |
| `BETTER_AUTH_SECRET` | a long random secret (below). Never reuse it elsewhere, never share it. | yes |
| `CRON_SECRET` | another long random secret, for [step 7](#7-turn-on-reminders) | for reminders |
| `SMTP_URL`, `MAIL_FROM` | your mail server, e.g. `smtps://user:pass@smtp.example.tn:465` | optional |
| `BETTER_AUTH_URL` | your own domain, e.g. `https://app.example.tn` — **only** if you attach a custom domain | optional |

Generate a secret on your computer (works on Windows, macOS and Linux, needs Node):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

You do **not** need to set `BETTER_AUTH_URL`, `TRUST_PROXY`, `TRUSTED_ORIGINS`, `NODE_ENV` or `PORT`: on
Vercel the app derives its public address from Vercel's own variables, trusts the proxy's
`X-Forwarded-For` (so the per-visitor sign-in rate limit works) and runs in production mode. Do not set
`REMINDER_WORKER`, `SERVE_STATIC` or `PDF_BROWSER`; they do not apply here.

## 5. Deploy

Press **Deploy**. The build runs `npm run build:vercel`, which:

1. generates the Prisma client for Vercel's Linux runtime,
2. builds the web app,
3. compiles the API,
4. **applies pending database migrations — Production deployments only** (a Preview can never change your
   live database). Set `SKIP_MIGRATIONS=true` if you prefer to migrate by hand.

When it finishes, open `https://<your-project>.vercel.app/api/health`. You should see:

```json
{ "status": "ok", "database": "ok" }
```

## 6. Create the first data

The database is empty, and sign-up is disabled by design: an administrator is created from the command
line. Run these **on your own computer** (they talk to Neon, not to Vercel). Use the **direct** connection
string.

**Windows PowerShell**

```powershell
$env:DATABASE_URL = "postgresql://…direct string…"
npm run db:seed          # demo data, see below
```

**macOS / Linux**

```bash
DATABASE_URL="postgresql://…direct string…" npm run db:seed
```

- **For a demo or a test with colleagues:** `npm run db:seed` creates two fictional offices and the test
  accounts listed in the [README](../README.md#try-it--test-accounts). Receipts are created with PDFs
  (your computer renders them). **Everyone who knows the address can sign in with the published
  password**, so use fictional data only, and consider turning on Vercel's *Deployment Protection*.
- **For a real office:** do **not** seed. Create the office and its administrator with a strong, private
  password instead:

  ```powershell
  $env:DATABASE_URL = "postgresql://…direct string…"
  $env:OFFICE_ADMIN_PASSWORD = "a-long-private-password"
  npm run office:create -- --name "مكتب …" --slug my-office --admin-name "…" --admin-email admin@example.tn
  ```

  The administrator then adds the team in **Settings → أعضاء المكتب**.

## 7. Turn on reminders

On a normal server a background worker delivers reminders. A serverless function cannot run one, so the app
exposes an endpoint that must be **called on a schedule**:

```
GET https://<your-domain>/api/cron/reminders
Authorization: Bearer <CRON_SECRET>
```

It answers `404` without the right secret and, with it, delivers what is due and returns a small report
(`{ "processed": 0, "sent": 0, … }`). Pick **one** way to call it every minute (or every few minutes):

| Option | Cost | How |
|---|---|---|
| **A. Vercel Cron** | Needs the **Pro** plan for per-minute schedules | Add to `vercel.json`: `"crons": [{ "path": "/api/cron/reminders", "schedule": "* * * * *" }]`. Vercel sends the `Authorization` header by itself once `CRON_SECRET` is set. |
| **B. An external scheduler** | Free | A service such as cron-job.org: create a job that calls the URL above every minute with the header `Authorization: Bearer <CRON_SECRET>`. |
| **C. Nothing** | — | Reminders are created but never delivered. Fine for a demo. |

> **Do not add a Vercel cron on the free (Hobby) plan.** Vercel rejects schedules more frequent than daily
> there, and a *daily* schedule is worse than none: the app cancels reminders delivered more than 12 hours
> after their time, so about half of them would be cancelled.

Test it (replace the values):

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR-PROJECT.vercel.app/api/cron/reminders
```

## 8. PDF receipts

Rendering a receipt PDF needs a headless Chromium **and** Arabic fonts. The Docker image provides both; a
Vercel function provides neither. Consequences on Vercel:

- recording a payment still works; the receipt is created with its number, and the screen says the PDF could
  not be generated, with a **retry** button that will keep failing;
- receipts created by `npm run db:seed` on your own computer already contain their PDFs.

Options if you need PDFs online: run the API from the Docker image on a container host (Render, Fly.io,
Railway…) and keep only the web app on Vercel; or add a remote-browser service. Neither is set up in this
project today.

## 9. Preview deployments

Every branch or pull request gets its own preview URL. Previews work (the preview address is trusted
automatically) but:

- they **never run migrations**;
- if you gave the Preview environment the same `DATABASE_URL`, they read and write your real data. Either
  leave the variables on *Production only*, or point Preview at a separate Neon branch (Neon branches are
  free copies);
- turn on **Deployment Protection** for previews so strangers cannot open them.

## 10. How it works

These files are the ones added by [DEPLOY_VERCEL_CODE_CHANGES.md](DEPLOY_VERCEL_CODE_CHANGES.md):

| File | Role |
|---|---|
| `vercel.json` | Build command, SPA fallback, `/api/*` → the function, security and cache headers |
| `api/index.js` | The function entry; re-exports the compiled server |
| `server/vercel-handler.ts` | Exposes the Hono app to Vercel as a Web-standard `fetch` handler |
| `server/routes/cron.ts` | `GET /api/cron/reminders`, protected by `CRON_SECRET` |
| `scripts/vercel-migrate.mjs` | Applies migrations on Production builds |
| `server/env.ts` | On Vercel: public address, trusted deployment address and proxy trust are derived automatically |

Updating: push to `main` → Vercel builds → migrations run → the new version goes live. Vercel's "instant
rollback" restores the previous *code* but **not** the database; keep migrations additive when you can, and
take a Neon backup (or branch) before a risky one.

## 11. Custom domain

Vercel → Project → **Domains** → add yours, then set `BETTER_AUTH_URL` to `https://your-domain` (Production)
and redeploy. The default `*.vercel.app` address keeps working.

## 12. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Build stops at `[migrate]` with a lock or connection error | `DATABASE_URL_UNPOOLED` is missing or is the pooled string. Use the **direct** one. |
| Build says "No database connection string" | The variables are not set for **Production**. |
| `/api/health` answers `503` / `"database": "unavailable"` | `DATABASE_URL` is wrong, or lacks `sslmode=require`. Check it in Neon. |
| Sign-in shows "تم رفض الطلب لأنه لم يصدر من واجهة التطبيق" (`CSRF_REJECTED`) | You opened the app from an address the server does not trust, typically a custom domain without `BETTER_AUTH_URL`. Set it (step 11). |
| Sign-in shows "An error occurred with your deployment"; Vercel Logs say `Task timed out after 30 seconds` for `POST /api/auth/sign-in/email` | The function was wrapped with the Node adapter instead of exporting `{ fetch }` (see `server/vercel-handler.ts`): Vercel's Node runtime consumes POST bodies first. Fixed in the commit after "Prepare for Vercel". |
| Sign-in works, then you are signed out at once | Session cookies are Secure-only: open the `https://` address, never `http://`. |
| `429` at sign-in | Rate limit or account lock: wait a minute (10 wrong passwords lock an account for 15 minutes). |
| Pages other than the home page show a Vercel 404 | `vercel.json` is missing from the deployed commit. |
| `PrismaClientInitializationError … query engine` | The function lacks the Prisma engine: redeploy with *Clear build cache*, and check that `vercel.json` still has `includeFiles` for `node_modules/.prisma/client`. |
| Receipts say the PDF was not generated | Expected on Vercel, see [step 8](#8-pdf-receipts). |
| Reminders never appear | No schedule is calling the endpoint, see [step 7](#7-turn-on-reminders). |
| Cold first request takes a few seconds | Normal for serverless after a quiet period (the function starts and connects to Neon). |

## 13. Security checklist

- [ ] `BETTER_AUTH_SECRET` and `CRON_SECRET` are long, random, private, and exist only in Vercel.
- [ ] No `.env` file is in the repository (it is git-ignored; check with `git ls-files | grep env`).
- [ ] A real office was created with `office:create` and a strong password, **or** the deployment holds
      fictional demo data only.
- [ ] Deployment Protection is on for previews.
- [ ] Neon backups: the free tier keeps a short history; take a manual branch before risky changes.
- [ ] Never put real client data into a deployment that uses the published demo password.
