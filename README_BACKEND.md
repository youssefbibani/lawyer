# قصر العدالة — Office backend

The office modules of the application — sign-in, dashboard, clients, cases, hearings, fees,
payments, PDF receipts, manual tasks and reminders, settings and members — run on a server-side
backend with a PostgreSQL database. This document covers installation, configuration, the database,
tests and deployment. The HTTP API is documented in [docs/API.md](docs/API.md).

The AI assistant, smart archive (OCR), document viewer and approval engine were **not** connected to
this backend. They keep their data in the browser, exactly as before (see
[Demo modules](#9-relationship-with-the-demo-modules)).

---

## 1. Architecture

```
Browser (React SPA, Arabic RTL)
   │  same origin: /api/auth/*  (Better Auth)      /api/v1/*  (office API)
   ▼
Hono server (Node 22)  ── server/app.ts
   ├─ request id, client address, security headers, 1 MB body limit
   ├─ /api/auth/*   allow-listed Better Auth endpoints + per-account sign-in lockout
   ├─ /api/v1/*     Origin check (CSRF) → session → active office membership → route
   │                 services/*  (validation, authorization, transactions, audit)
   ├─ reminder worker (in-process, safe with several instances)
   └─ PDF receipts: headless Chromium (playwright-core)
   ▼
PostgreSQL (Prisma)  — composite tenant foreign keys, CHECK constraints, append-only triggers
```

| Concern | Choice | Why |
|---|---|---|
| HTTP server | **Hono 4** on `@hono/node-server` | The app is a Vite + React SPA (not Next.js). A small server next to it avoids rewriting the frontend; in production it also serves the built SPA, so cookies stay same-origin. |
| Database | **PostgreSQL** (15+; developed on 18, Docker uses 17) | Transactions, row locks, numeric money, CHECK constraints, triggers, `pg_trgm` search. |
| ORM / migrations | **Prisma 6.19** | Typed queries, migration history. Prisma 7 was not used: its configuration changes were not needed. |
| Authentication | **Better Auth 1.6** | E-mail/password, sessions, password reset, TOTP two-factor, rate limiting, organization tables. |
| Validation | **Zod 3** | Already used by the frontend; Arabic error messages. |
| PDF | **playwright-core** + Chromium | Correct Arabic shaping and RTL layout without a separate PDF layout engine. |
| E-mail | **nodemailer** (optional SMTP) | Without SMTP, e-mail is reported as *not configured*, never as sent. |
| Tests | Vitest (server integration on a real database), Playwright (browser) | |

Source layout:

```
server/
  app.ts index.ts env.ts db.ts auth.ts
  http/        context, errors (Arabic messages), middleware (CSRF, session, rate limit), validation
  lib/         time (Africa/Tunis), money (exact decimals), text (Arabic search normalisation)
  routes/      auth.ts (Better Auth allow-list), v1.ts (office API)
  services/    authorization, audit, clients, cases, hearings, finance, receipt-pdf, tasks,
               reminders, dashboard, settings, offices, mailer, dto
  tests/       integration tests (real PostgreSQL)
shared/api.ts  API contract (types + enum lists) shared by server and web client
src/backend/   web client: http client, auth flows, React Query hooks, labels, formatting
prisma/        schema.prisma, migrations/, seed.ts (development only)
e2e/           Playwright specs (real server + test database)
scripts/       local-postgres.mjs, create-office.ts, protected-files.mjs
```

## 2. Requirements

- Node.js 22 (uses `process.loadEnvFile`, `fetch`, `--env-file`).
- PostgreSQL 15 or newer with the `pg_trgm` extension (included in standard PostgreSQL packages
  and the official Docker image).
- Google Chrome, Microsoft Edge, or Playwright's Chromium for PDF receipts (see `PDF_BROWSER`).
  In Docker the image installs Chromium and the Noto Arabic fonts.

## 3. Local setup

```bash
npm install
cp .env.example .env            # then fill in the backend section (see §4)
```

### 3.1 Database

Pick one:

- **Project-local PostgreSQL (no Docker, no admin rights)** — uses an installed PostgreSQL's binaries
  to create a private cluster in `.pgdata/` (git-ignored) on port 54329 with trust authentication on
  127.0.0.1 only:

  ```bash
  npm run db:local -- init      # creates the cluster + qasr_dev and qasr_test, prints the URLs
  npm run db:local -- start | stop | status
  ```

  `PG_BIN` points to the PostgreSQL `bin` folder (default `C:/Program Files/PostgreSQL/18/bin` on
  Windows; on Linux/macOS the binaries must be on `PATH` or `PG_BIN` set).
- **Docker** — `docker compose --env-file .env.docker up -d db` (see §7), then use
  `postgresql://qasr:<password>@127.0.0.1:5432/qasr` after publishing the port, or
- **An existing server** — create two databases, one for development and one for tests
  (the test database name **must contain `test`**; tests refuse to run otherwise).

Put the URLs in `.env` as `DATABASE_URL` and `DATABASE_URL_TEST`.

### 3.2 Migrations

```bash
npx prisma migrate deploy       # apply all migrations (non-destructive)
npm run db:migrate              # schema development: create a new migration from schema.prisma
```

### 3.3 Development data (never in production)

```bash
npm run db:seed
```

Creates two fictional offices through the real services (validation, numbering, audit), with the
reserved `.example` e-mail domain. Default password `adala12345` for every account (override with
`SEED_PASSWORD`; the server's minimum is 10 characters). The seed refuses to run when
`NODE_ENV=production`, and resumes cleanly if an earlier run stopped part-way. Running it again on an
existing database re-applies the current seed password to the seed accounts, so changing the password
never requires wiping the data.

| Account | Role | Office |
|---|---|---|
| `h.majri@ayari.example` | admin | مكتب الأستاذ منير العياري (lawyers see only their files) |
| `m.ayari@ayari.example` | lawyer | same |
| `s.haddad@ayari.example` | lawyer (has a confidential file) | same |
| `a.zouari@ayari.example` | clerk | same |
| `r.cherif@cherif.example` | admin | مكتب الأستاذة ريم الشريف (second office, for isolation checks) |

### 3.4 Run

```bash
npm run dev:server     # API on :3001 (watch mode, reads .env)
npm run dev            # web app on :8080, proxies /api to :3001
```

Open http://localhost:8080 and sign in with a seeded account. Without SMTP, "forgot password" answers
that e-mail is not configured; an administrator can set a new password from Settings → أعضاء المكتب.

## 4. Environment variables

Only the server reads these; the browser bundle sees `VITE_*` variables only.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string. |
| `DATABASE_URL_TEST` | for tests | — | Separate disposable database (name must contain `test`). |
| `BETTER_AUTH_SECRET` | yes | — | ≥ 32 random characters. Production refuses development/placeholder values. |
| `BETTER_AUTH_URL` | yes in production | `http://localhost:8080` | Public address users open. Its origin is always trusted for CSRF. Production warns if it is not `https://`. |
| `TRUSTED_ORIGINS` | no | empty | Extra comma-separated origins allowed to send cookie-authenticated mutations. |
| `PORT` | no | `3001` | API port. `HOST` (default `0.0.0.0`) sets the bind address. |
| `SMTP_URL` | no | empty | e.g. `smtps://user:pass@smtp.example.tn:465`. Empty = e-mail "not configured". |
| `MAIL_FROM` | no | `قصر العدالة <no-reply@example.tn>` | Sender address. |
| `PDF_BROWSER` | no | `bundled` | `bundled` (Playwright Chromium), `chrome`, `msedge`, or an absolute path. |
| `SERVE_STATIC` | no | `false` | `true` serves the built SPA (`dist/`) from the API server. |
| `TRUST_PROXY` | no | `false` | `true` only behind a reverse proxy you control; uses the right-most `X-Forwarded-For` entry as the client address. |
| `REMINDER_WORKER` | no | `true` | `false` disables reminder delivery in this process. |
| `SEED_PASSWORD` | no | `adala12345` | Password for development seed accounts (≥ 10 characters). |

## 5. Data model and guarantees

Defined in `prisma/schema.prisma`; migrations in `prisma/migrations/`:

1. `…_init` — all tables, plus CHECK constraints and triggers (below).
2. `…_search_snapshot_throttle` — case timeline link on audit entries, receipt snapshot,
   normalised search columns with `pg_trgm` GIN indexes, per-account sign-in throttle table.
3. `…_fee_agreement_idempotency` — optional idempotency key on fee agreements.

**Tenant isolation.** Every office-owned row carries `organizationId`. Services filter every query by
the office resolved from the session, and child rows reference their parents through composite
`(id, organizationId)` foreign keys, so the database itself rejects a hearing, payment, task or link
that points at another office's case, client or member. Inaccessible records answer `404`.

**Money.** `numeric(14,3)` (millimes), transported as decimal strings (`"1500.250"`), computed with
decimal arithmetic. Currency per agreement (`TND` by default, office-configurable).

**Payments and receipts.**
- Recording a payment is one transaction: the fee agreement row is locked (`SELECT … FOR UPDATE`),
  the balance is recomputed, the payment and its receipt are inserted, and the office's counter for the
  year is incremented. Numbers (`REC-YYYY-NNNNNN`) are gap-free and unique per office and year.
- `Idempotency-Key` is required: a retried submission returns the original payment, never a second one.
- Overpayment is refused; duplicate cheque/transfer references on one agreement are refused.
- Nothing financial is deleted or edited. A mistaken payment is *voided* with a reason, which cancels
  its receipt (still listed, shown stamped «ملغى»), restores the balance, and allows recording again.
- The receipt stores a frozen snapshot of everything printed on it, and the PDF is write-once with its
  SHA-256. If PDF rendering fails, the receipt still exists, the failure is recorded and shown, and the
  user can retry. A receipt is never reported as generated unless rendering succeeded.

**Database-level rules** (defence in depth — the API checks them first): positive amounts, ISO currency
codes, valid task times, a reminder targets exactly one task or hearing, closing date after opening date;
triggers make `audit_logs` and `hearing_events` append-only, block deleting or editing payments
(except voiding) and receipts (except cancellation and the one-time PDF), and forbid decreasing a
receipt counter.

**Time.** Hearings are entered as a date and a time in the office time zone (`Africa/Tunis` by
default) and stored as a UTC instant; the time is mandatory. A local time that does not exist in the
time zone is rejected rather than shifted. Calendar dates (opening dates, payment dates, task dates)
are SQL `DATE` values and never get an invented time; a task without a time has no reminder instant.

**Hearings.** Every change is kept in `hearing_events` (created, updated, rescheduled with the previous
and new time, status changes, cancellation with reason). Overlapping hearings of the same lawyer
produce a `409 HEARING_CONFLICT` warning listing the clashes (hearings in files the user cannot see are
counted, not described); the user must explicitly acknowledge to save. Postponing can create the
follow-up hearing in the same step.

**Audit log.** Every write records the actor, office, operation, a short non-confidential Arabic
summary, redacted before/after values, IP address, user agent and request id. Denied attempts are
recorded with outcome `DENIED`. Note and document contents are never copied into the log. The case
timeline is read from this log.

## 6. Security model

**Authentication** (Better Auth): e-mail + password (10–128 characters), scrypt hashing, sessions in an
httpOnly `SameSite=Lax` cookie (`Secure` and `__Secure-` prefix in production), 12-hour session
lifetime refreshed hourly while active, TOTP two-factor with backup codes, password reset by e-mailed
one-hour link (revokes all sessions; without SMTP the request is refused with the same answer for every
address, and administrators can set a new password), password change can revoke other sessions. Public sign-up is
disabled; administrators create members, and `npm run office:create` bootstraps the first office.
Accounts whose memberships are all deactivated cannot sign in; deactivation ends their sessions.

Only an allow-list of Better Auth endpoints is exposed. Organization-plugin administration endpoints
(create office, invite, change roles, remove members) are blocked; membership changes go through
`/api/v1/settings/members`, which applies office rules and audits. Session tokens are removed from all
JSON responses: scripts in the page can never read them.

**Abuse protection.** Per-address limits (database-backed): 5 sign-ins per minute, 3 reset requests per
5 minutes, 5 two-factor attempts per minute. Per-account lockout: 10 failed sign-ins in 15 minutes
lock that account for 15 minutes, whatever the address. API: 600 requests per minute per user and
address (in memory, per instance).

**CSRF.** Every mutating `/api/v1` request must carry an `Origin` in the trusted list; Better Auth
applies the same check to its endpoints; cookies are `SameSite=Lax`; bodies must be JSON.

**Authorization.** Identity, office and role are resolved on the server from the session and the
membership table on every request — never from the request. Permissions:

| Permission | admin | lawyer | clerk |
|---|:-:|:-:|:-:|
| Read / write clients, read / create / edit cases, notes, schedule hearings, tasks | ✓ | ✓ | ✓ |
| Change case status, reassign lawyer, edit case staff | ✓ | ✓ | — |
| Cancel hearings | ✓ | ✓ | — |
| Read finances, record payments | ✓ | ✓ | only if the office enables «الكتبة يسجّلون الدفعات» |
| Manage fee agreements, void payments | ✓ | ✓ | — |
| Office settings, members, server audit log | ✓ | — | — |

Data scope: administrators see every file of their office; lawyers see every file when
«المحامون يرون كل ملفات المكتب» is on (default), otherwise files assigned to them or where they are on
the staff; clerks see files where they are on the staff unless «الكتبة يرون كل ملفات المكتب» is on.
Clients follow their files; tasks follow their file, or their assignee and creator when not linked to a
file. Hearings, fees, payments and receipts follow their file.

**Logging.** No request bodies, query parameters, passwords, tokens or document contents are logged.
Unexpected errors log the request id, error type/code and the first line of the message; the client
receives a generic Arabic message with the same request id. Prisma's own query logging is disabled.

**Headers.** API responses: `Cache-Control: no-store`, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Cross-Origin-Resource-Policy`. The SPA shell gets `X-Frame-Options`,
`X-Content-Type-Options` and `Referrer-Policy`. A strict Content-Security-Policy is **not** set yet,
because the demo archive loads its OCR engine from a CDN (see limitations).

## 7. Tests

```bash
npm run test:run          # frontend (Vitest, jsdom)
npm run test:server       # backend integration: real HTTP requests + real PostgreSQL (DATABASE_URL_TEST)
npm run test:e2e          # Playwright: real API server on the test database + Vite, desktop and phone
npm run typecheck && npm run lint
npm run check:protected   # proves the protected AI / archive / approval files are byte-identical
```

- Integration tests apply migrations with `prisma migrate deploy` (never a reset), and every test
  creates its own offices, so runs never delete data and can repeat against the same database.
- PDF tests use a minimal valid PDF by default; one test renders a real Arabic receipt with Chromium
  (it reports, rather than hides, a missing browser).
- E2E tests use the installed Chrome (`PLAYWRIGHT_CHANNEL=msedge` for Edge, or install Playwright's
  Chromium) and create a fresh office per run in the test database.

## 8. Deployment

### Docker Compose

```bash
cp .env.docker.example .env.docker          # set POSTGRES_PASSWORD, BETTER_AUTH_SECRET, PUBLIC_URL, SMTP…
docker compose --env-file .env.docker up -d --build
# first office and administrator (password via the environment, never on the command line):
docker compose --env-file .env.docker run --rm -e OFFICE_ADMIN_PASSWORD='…' migrate \
  npm run office:create -- --name "مكتب …" --slug mon-cabinet --admin-name "…" --admin-email admin@…
```

Services: `db` (PostgreSQL 17, data in the `pgdata` volume, port not published), `migrate`
(`prisma migrate deploy`, then exits), `app` (API + built SPA on port 3001, health check on
`/api/health`, Chromium and Noto Arabic fonts for receipts).

Put a TLS-terminating reverse proxy in front of `app`, forward `X-Forwarded-For`, keep
`TRUST_PROXY=true`, and set `PUBLIC_URL` to the `https://` address. Production cookies are Secure-only:
sign-in does not work over plain HTTP.

### Without Docker

```bash
npm ci && npx prisma generate
npm run build && npm run build:server        # dist/ and dist-server/
npx prisma migrate deploy
NODE_ENV=production SERVE_STATIC=true node dist-server/server/index.js
```

Install Chromium for receipts (`npx playwright-core install --with-deps chromium`, or set
`PDF_BROWSER=chrome`) and an Arabic font (e.g. `fonts-noto-core` on Debian/Ubuntu).

### Operations

- **Upgrades:** deploy the new version, then `prisma migrate deploy` (the `migrate` service does it).
- **Backups:** `pg_dump` the database regularly and test restores. Receipt PDFs are stored in the
  database, so a database backup includes them.
- **Several instances:** reminder delivery claims rows with `FOR UPDATE SKIP LOCKED` and is safe to
  run everywhere; the API rate limiter is per instance (use the proxy for global limits).

## 9. Relationship with the demo modules

The AI assistant, voice, smart archive/OCR, document viewer, archive search and the approval engine
were declared out of scope for this phase and were not modified (`npm run check:protected` verifies
61 files byte-for-byte). Consequences:

- They still use the in-browser demo store and the demo identity (switchable in Settings, clearly
  labelled «الوحدات التجريبية»). Actions they perform — hearings, tasks, receipts created by the
  assistant through approvals — are saved in the browser only and do not appear in the server data.
- The case page's documents tab, the archive link and the assistant link find the demo case with the
  same reference; if none exists, the documents tab says so.
- All `/app` pages, including the demo modules, now require a real server session.

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| Receipt shows «ملف PDF لم يُولَّد» | Check `PDF_BROWSER` and that Chrome/Chromium starts on the server; then use «إعادة محاولة التوليد». |
| `EPERM … query_engine-windows.dll.node` on `prisma generate` | A running server holds the Prisma engine on Windows: stop it first. |
| `429` at sign-in | Rate limit or account lockout; wait (the response has `Retry-After`). |
| `403 CSRF_REJECTED` | The page's origin is not `BETTER_AUTH_URL`'s origin nor in `TRUSTED_ORIGINS`. |
| Sign-in works with curl but not in the browser in production | HTTPS is required (Secure cookies). |
