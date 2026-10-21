# قصر العدالة — Tunisian LegalTech workspace (prototype)

Arabic-only, RTL, mobile-first workspace for Tunisian lawyers and office staff, including
**المساعد القانوني الذكي** (AI legal assistant), **المهام والتذكيرات** (tasks & reminders), a centralised
**human-approval engine** («طلبات الموافقة») and a **smart archive digitisation workflow** («الأرشفة الذكية»).

> **Two layers.** The office modules — sign-in, dashboard, clients, cases, hearings, fees / payments /
> PDF receipts, manual tasks & reminders, settings — run on a **real backend** (PostgreSQL + Hono API +
> Better Auth); see **[README_BACKEND.md](README_BACKEND.md)** and **[docs/API.md](docs/API.md)**.
> The AI assistant, smart archive (OCR), document viewer and approval engine are unchanged from the
> previous phases and still keep their data in the browser (localStorage, encrypted IndexedDB for
> scanned originals); they are labelled as demo modules in the UI.

## Try it — test accounts

The development database is filled with fictional offices, clients, cases, hearings, fees and tasks by
`npm run db:seed`. **Every account uses the same password:**

> ### `adala12345`

| Role | Name | Sign in with (e-mail) | Office |
|---|---|---|---|
| **Office administrator** · مدير المكتب | هالة الماجري | `h.majri@ayari.example` | مكتب الأستاذ منير العياري للمحاماة |
| **Lawyer** · محامٍ | الأستاذ منير العياري | `m.ayari@ayari.example` | same office |
| **Lawyer** · محامية (owns a confidential file) | الأستاذة سلمى الحداد | `s.haddad@ayari.example` | same office |
| **Clerk** · كاتبة المكتب | أمينة الزواري | `a.zouari@ayari.example` | same office |
| **Administrator of a second office** (to check that offices never see each other's data) | الأستاذة ريم الشريف | `r.cherif@cherif.example` | مكتب الأستاذة ريم الشريف للمحاماة |

What each role can do, at a glance (full detail in [docs/ROLES_AND_PERMISSIONS.md](docs/ROLES_AND_PERMISSIONS.md)):

| | Administrator | Lawyer | Clerk |
|---|:-:|:-:|:-:|
| Clients, cases, notes, hearings, tasks | ✓ | ✓ | ✓ (only files they are staffed on) |
| Change case status · reassign lawyer · cancel hearings | ✓ | ✓ | — |
| Fees, payments, PDF receipts | ✓ | ✓ | — (unless the office allows it) |
| Office settings · members · office audit log | ✓ | — | — |

Good first things to try, per account, are in [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md).

**Good to know**
- Sign in at http://localhost:8080 after starting the app (below). Dates in the demo data are relative to
  the day the database was seeded.
- Too many sign-ins in a short time answer "429": wait a minute. Ten wrong passwords lock that account for
  15 minutes.
- The password can be changed for the whole seed with `SEED_PASSWORD=… npm run db:seed`; re-running the seed
  re-applies the password to existing seed accounts without touching their data. The server requires at
  least 10 characters.
- **These credentials are public. They are for local and demo databases only.** The seed refuses to run
  when `NODE_ENV=production`; for a real office create the administrator with `npm run office:create`
  and a strong, private password (see README_BACKEND.md).

## Documentation

| File | What it explains |
|---|---|
| [docs/PLATFORM_OVERVIEW.md](docs/PLATFORM_OVERVIEW.md) | What the platform is, who it is for, every screen, what is real vs. demo |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Screen-by-screen guide for daily use |
| [docs/ROLES_AND_PERMISSIONS.md](docs/ROLES_AND_PERMISSIONS.md) | Roles, permissions, who sees which files, the demo-module roles |
| [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) | Step-by-step test scenarios per account, with expected results |
| [docs/UI_AND_DESIGN.md](docs/UI_AND_DESIGN.md) | Visual language, responsive and scrolling behaviour, accessibility |
| [README_BACKEND.md](README_BACKEND.md) | Installation, configuration, database, security model, deployment |
| [docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md) | Hosting on Vercel + Neon: steps, environment variables, limits, troubleshooting |
| [docs/DEPLOY_VERCEL_CODE_CHANGES.md](docs/DEPLOY_VERCEL_CODE_CHANGES.md) | The code changes that let the API run on Vercel (reference: what changed and why) |
| [docs/API.md](docs/API.md) | HTTP API reference |

## Run locally

```bash
npm install
# backend: database, .env, migrations, seed — see README_BACKEND.md
npm run dev:server   # API on http://localhost:3001
npm run dev          # web app on http://localhost:8080 (proxies /api) — sign in with a seeded account
npm run lint         # oxlint
npm run typecheck    # web + server
npm run test:run     # vitest (jsdom)
npm run build && npm run preview
```

Optional configuration: copy `.env.example` to `.env.local` (see *Backend integration*).
The first archive OCR run downloads the Tesseract engine and the Arabic + French models (from jsDelivr
unless `VITE_OCR_LANG_PATH` points to self-hosted files); scanned images never leave the device.

Demo tips
- **Settings → الدور والصلاحيات (الوحدات التجريبية)** switches the *demo identity* (lawyer, associate,
  clerk, accountant, administrator) used by the assistant, archive and approvals only. It does not change
  your real role on the server, which comes from the account you signed in with.
- **Settings → سياسة الموافقات** toggles "clerk proposals require a lawyer's approval".
- **Settings → البيانات التجريبية** restores the seed data (dates are relative to the day of seeding).
- Try: as the clerk (أمينة), ask the assistant «سجّللي جلسة نهار 11 نوفمبر مع ملف عائلة بن صالح على الساعة 10»,
  send it for approval, switch to the lawyer and decide in «طلبات الموافقة».

## What is genuinely functional vs. simulated

| Area | Status |
|---|---|
| Mobile layout (320 → desktop), bottom navigation, bottom sheets, safe areas, keyboard inset, 44px touch targets | **Functional** — audited headless at 320/375/390/430/768/1024/1280 px, zero horizontal overflow |
| Human approval engine: proposals, edit, approve/reject, stale detection, idempotent execution, role policy | **Functional** (local). Enforcement lives in the in-browser service layer — see *Production risks* |
| Hash-chained audit log with tamper verification | **Functional** (local; tamper-*evident*, not tamper-*proof*) |
| Clients, cases, notes, hearings (Tunis time, history, conflicts), fees, payments, PDF receipts, manual tasks & reminders, office settings, members | **Functional, server-side** (PostgreSQL) — see README_BACKEND.md |
| Records created by the assistant / approval engine (hearings, tasks, receipts, document links) | **Local demo store only** — the protected assistant and approval engine were not connected to the backend in this phase |
| Archive: batches, multi-file upload, camera capture, PDF rasterisation (pdf.js), thumbnails, page reorder/rotate/replace | **Functional** |
| Archive: Arabic / French / mixed OCR with per-word confidence | **Functional — real Tesseract** in a Web Worker (verified end-to-end: 91–95% confidence on generated scans) |
| Archive: blank / blurry / missing-page detection, field extraction, classification, duplicates (SHA-256 + text + metadata), case matching | **Functional, rule-based** with confidence + evidence. Heuristics — always reviewed by a human |
| Archive: original storage | **Functional**: write-once, AES-GCM encrypted IndexedDB (non-extractable key). Not shared across devices |
| Archive: resumable processing, retries, re-attach after interrupted upload, multi-tab job claiming | **Functional** while a tab is open (no server-side background workers) |
| Archive search & assistant over verified archived documents | **Functional lexical search** (Arabic normalisation + AR/FR synonym expansion). **Not** an embedding model |
| Assistant: intents, entities, dates, case resolution, previews → approval requests | **Functional, rule-based** (no LLM). Replies labelled «تجريبي» |
| Assistant: summaries, hearing briefs, comparisons, archive shortcuts | **Simulated generation** from retrieved text with page citations; suggestions labelled; never invents legislation or case-law |
| Voice dictation / read-aloud | **Functional** via Web Speech API (consent required) and `speechSynthesis`; server STT needs `VITE_STT_API_URL` |
| Authentication, sessions, password reset, TOTP two-factor, rate limiting | **Functional, server-side** (Better Auth) |
| E-mail (reset links, reminders) | **Functional when `SMTP_URL` is set**; otherwise reported as "not configured", never as sent |
| SMS, server OCR, LLM | **Not implemented** — adapters/contracts only |

## Architecture

```
src/
  lib/hash.ts            Sync SHA-256 + canonical JSON (approval binding, audit chain); WebCrypto for files.
  services/
    db.ts                Local persistence (v3, migrates v2 data): commit() = write → read-back verify → notify.
    api.ts               Service boundary: permission-filtered reads; validated, authorised, audited writes.
                         Approval gate: assistant-originated writes only run inside runUnderApproval().
    audit.ts             Append-only hash chain (sealEntry / verifyAuditChain).
    approvals.ts         Approval engine: operation registry (validate, bindings, execute, editable fields),
                         propose → revise → decide → execute, stale detection, idempotency, policy.
    permissions.ts       Roles → permissions, per-case access, PROPOSE_PERMISSION, approverRolesFor(policy).
    retrieval.ts         RetrievalService + LocalRetrievalService, injection detection, citation links.
    archive/
      workflow.ts        States, allowed transitions, categories, file validation.
      service.ts         Archive service: tenant + permission checks, transition enforcement,
                         optimistic concurrency (expectedVersion), history; gated verify/finalize.
      pipeline.ts        Persisted job queue (claim + heartbeat), import → prepare → OCR → analysis, resume.
      blobStore.ts       Write-once storage; EncryptedIdbBlobStore (AES-GCM) / MemoryBlobStore.
      imaging.ts         pdf.js rasterisation, EXIF-aware decoding, thumbnails, rotation, quality.
      ocr.ts             OcrProvider: TesseractOcrProvider (ara+fra), ServerOcrProvider, none.
      quality.ts         Blank/blurry/low-contrast metrics on pixels; missing-page detection.
      analysis.ts        Field extraction, classification, duplicates, case matching (with evidence).
      actions.ts         Submit verification / withdraw / request finalisation (approval requests only).
      assistant.ts       Archive shortcuts: summarise, similar documents, suggest case, check data, lawyer brief.
    assistant/           Intent parser, engine, briefs, providers, prompt contract; actions.ts maps
                         previews to approval-engine operations.
  components/approvals   ApprovalPanel (reusable Arabic card), ApprovalRequestCard (confirm / edit / reject).
  components/archive     Stepper, badges, thumbnails, case-match & duplicate panels, page editor, job runner.
  pages/                 Approvals, archive/{ArchiveDashboard, BatchCreate, BatchWorkspace, ReviewWorkspace},
                         Assistant, BriefEditor, Tasks + upgraded existing pages.
```

Routes: `/app/approvals`, `/app/archive` (monitoring), `/app/archive/new` (step 1),
`/app/archive/batches/:id?step=upload|extract|classify|review|match|finalize` (steps 2–7),
`/app/archive/batches/:id/review/:itemId` (split-screen verification), `/app/assistant` (`/assistant` redirects).

### Archive states
`مسودة → قيد الرفع → قيد استخراج النص → في انتظار المراجعة → (تحتاج إلى تصحيح ↔) → في انتظار الموافقة →
جاهزة للأرشفة → مؤرشفة`, plus `فشلت المعالجة` (retry). Transitions outside `workflow.ts#TRANSITIONS` are rejected.

### Safety guarantees (enforced in code and tests)
- **Explicit human approval**: AI and clerks only *propose*. Execution requires a decision by a role the
  office policy allows; there is no implicit, pre-selected or timed approval. The assistant has no
  decide/execute path.
- **Binding**: approvals are bound to the SHA-256 of the exact parameters and to fingerprints of the
  records involved (case, time slot, hearing, payment, archive-item version). Any change → `stale`.
- **No bypass**: gated data-layer writes refuse to run outside an active, matching approval; tampering with
  stored parameters after approval is detected.
- **Idempotent**: a request executes at most once (status + in-flight guard); finalisation is atomic.
- **Never fake success**: every write is verified by read-back; OCR failures and missing engines move
  documents to «فشلت المعالجة» instead of producing results.
- **Originals are immutable**: write-once storage; page replacement keeps the previous scan; nothing is
  deleted, merged or overwritten automatically (duplicates are only flagged / excluded by a human).
- **OCR text is untrusted**: original OCR, human corrections and assistant suggestions are stored separately;
  instruction-like text is flagged and never executed.
- **Legal grounding**: quotes carry document/page citations; drafts stay drafts until a lawyer reviews them.

## Backend integration (what a real deployment needs)

1. **Assistant API** — `POST {VITE_ASSISTANT_API_URL}/assistant/chat` (NDJSON stream; see `provider.ts`).
   The LLM may only call read tools and *proposal* tools that create approval requests.
2. **Approval & audit service** — move `approvals.ts` + `audit.ts` server-side: authenticate the
   decider, re-validate and re-fingerprint inside the execution transaction, write the audit chain to
   append-only storage (or a WORM/ledger table), and expose the same request contract.
3. **Archive service** — object storage with server-managed encryption for originals, a job queue
   (e.g. worker pool) for OCR, `ServerOcrProvider` endpoint (`VITE_OCR_API_URL`), state-machine
   enforcement in the API, per-tenant isolation on every query.
4. **Retrieval** — page-level chunks with metadata → hybrid (lexical + embeddings) index →
   permission filter before ranking → cite `docId/page`.
5. **Persistence & identity** — done for the office modules (see README_BACKEND.md); the demo modules
   above still use the local store and the demo identity. Retention/deletion policies remain to be defined.
6. **Speech / notifications** — `VITE_STT_API_URL`; e-mail via `SMTP_URL` (done); SMS provider (not done).
7. **Logging** — never log message bodies, OCR text or document content; ids and action names only.

## Tests

Backend: `server/tests/` (integration, real PostgreSQL) and `e2e/` (Playwright, real browser) — see
README_BACKEND.md. Frontend: `src/tests/` — tests of the migrated pages use a fetch test double.

`src/tests/` — earlier phases: original page tests, intent parsing and ambiguous dates,
no-write-before-confirmation, conflicts, unknown/restricted cases, roles, storage failure, brief citations,
retrieval and authorization, assistant UI and voice states, tasks, document viewer, navigation,
**approval engine** (clerk → lawyer flow, unauthorized decisions, edit/resubmit, reject, stale approvals,
duplicate execution, parameter tampering, direct-API bypass, policy), **archive workflow** (single and
batch upload, Arabic/French/mixed OCR, blank/blurry/missing pages, duplicates, wrong classification and
override, metadata and OCR correction, return/resubmit, uncertain case matching, failed and repeated
finalisation, interrupted upload + re-attach, abandoned jobs resumed without repeating OCR, concurrent
edits, audit-chain tampering), extraction regressions on **real Tesseract output**, pixel-quality
calibration, approvals page UI and mobile review.
