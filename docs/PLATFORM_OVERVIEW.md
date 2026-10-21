# قصر العدالة — Platform overview

**قصر العدالة** ("Palace of Justice") is an Arabic-only, right-to-left workspace for Tunisian law offices.
It brings the daily work of an office into one place: clients, case files, court hearings, deadlines and
reminders, fee agreements with payment receipts, scanned-document archiving, and an assistant that
prepares work for a human to approve.

It is mobile-first: the same screens work on a phone, a tablet and a desktop browser. Dates and hearing
times use Tunisian time (`Africa/Tunis`), and money is kept exactly in Tunisian dinars with millimes
(three decimals).

> **Status: working prototype.** The office modules run on a real server and database. A few modules
> (assistant, archive, approvals) still run inside the browser and are labelled as demo modules. The
> table below says exactly which is which.

---

## 1. Who uses it

| Person | Typical use |
|---|---|
| **Office administrator** (مدير المكتب) | Sets up the office, adds team members, sees everything, follows money and the audit log. |
| **Lawyer** (محامٍ) | Owns case files, schedules hearings, follows deadlines, records fees and payments. |
| **Clerk** (كاتب/ة المكتب) | Prepares work: opens files, adds clients and notes, schedules hearings, creates tasks. Cannot change case status or see money unless the office allows it. |

Roles and permissions are described in [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md).

## 2. Two layers: real and demo

| Layer | Modules | Where the data lives |
|---|---|---|
| **Real (server-backed)** | Sign-in and sessions · dashboard · clients · cases and notes · hearings and agenda · tasks and reminders · fee agreements, payments and PDF receipts · office settings and members · audit log | PostgreSQL, behind an authenticated API. Every office's data is isolated from every other office. |
| **Demo (local to the browser)** | Legal assistant · smart archive (scan, OCR, classify) · document viewer · archive search · approval requests | The browser (localStorage; scanned originals in an encrypted IndexedDB). Clearly labelled «تجريبي» in the interface. What these modules create is **not** visible on the server side. |

Why the split: the real modules were built on a backend first; the assistant, archive and approval
engine were delivered earlier as a local prototype and were left untouched by the backend work. A script,
`npm run check:protected`, guards their files against unintended edits; its baseline is re-recorded
(`node scripts/protected-files.mjs --write`) when one of them is changed on purpose, as with the chat
scrolling fix.

## 3. Screen map

| Menu item | Route | Purpose | Layer |
|---|---|---|---|
| **لوحة التحكم** Dashboard | `/app` | Active cases, hearings in the next 7 days, today's and overdue tasks, unpaid dues, hearing-conflict warning, shortcuts. | Real |
| **المساعد القانوني الذكي** Assistant | `/app/assistant` | Ask in Tunisian dialect or standard Arabic about files, hearings and fees; it prepares actions as requests for approval. | Demo |
| **القضايا** Cases | `/app/cases`, `/app/cases/:id` | Search and filter files; one page per file with overview and timeline, documents, hearings, tasks, fees, notes. | Real |
| **الحرفاء** Clients | `/app/clients` | Client cards (individual, company, heirs, administration, other) and their files. | Real |
| **الجلسات** Hearings | `/app/agenda` | Month calendar of hearings, upcoming list, conflict alerts, reminder settings. Page title: المفكرة الذكية. | Real |
| **المهام والتذكيرات** Tasks | `/app/tasks` | Tasks and reminders by bucket: today, upcoming, overdue, done. Priorities and recurrence. | Real |
| **طلبات الموافقة** Approvals | `/app/approvals` | Every operation proposed by the assistant or a clerk waits here for an explicit human decision. | Demo |
| **الأرشفة الذكية** Smart archive | `/app/archive/...` | Upload or photograph documents, extract text (OCR), classify, review, link to a case, finalize. | Demo |
| **البحث الذكي** Search | `/app/search` | Search the verified archived documents (Arabic-aware); opens the document viewer with highlights. | Demo |
| **الأتعاب** Fees | `/app/payments` | Fee agreements per file, payments, numbered PDF receipts, voiding, payment reminders. | Real |
| **الإعدادات** Settings | `/app/settings` | Profile, office data and rules, appearance, notifications, security (password, two-factor), members, audit log, assistant and voice preferences. | Real + demo |

A walk-through of each screen is in [USER_GUIDE.md](USER_GUIDE.md).

## 4. Principles the platform is built on

- **A human decides.** The assistant and clerks only *propose*. Nothing is executed until a person with
  the right role approves it. There is no automatic or timed approval.
- **Every office is a sealed room.** Each record belongs to one office; the database itself refuses links
  across offices. A record you may not see answers as if it did not exist.
- **Nothing is silently lost or invented.** Writes are verified. Failures (a receipt PDF that could not be
  rendered, an OCR that failed, an e-mail that cannot be sent) are shown as failures, never as success.
- **Money is never edited.** A wrong payment is *voided* with a reason; its receipt is cancelled but kept.
  Receipt numbers (`REC-YYYY-NNNNNN`) are gap-free per office and year.
- **Everything leaves a trace.** An append-only audit log records who did what and when, without copying
  confidential contents. The case timeline is read from it.
- **Time is explicit.** A hearing always has a date *and* a time in the office time zone; an impossible
  local time is rejected rather than shifted.

## 5. Technology in one paragraph

A React 18 + TypeScript single-page app (Vite, Tailwind CSS, Radix UI, React Query, React Router) talks to
a Hono (Node 22) API. Data lives in PostgreSQL through Prisma; authentication is Better Auth (e-mail and
password, sessions, TOTP two-factor); validation is Zod; PDF receipts are rendered by headless Chromium so
Arabic shapes and right-to-left layout are correct. Tests: Vitest (components, and server integration
against a real database) and Playwright (real browser, desktop and phone). Details:
[README_BACKEND.md](../README_BACKEND.md).

## 6. Known limits

- The assistant is a **rule-based engine, not a language model**. Its replies are labelled «تجريبي» and it
  never invents legislation or case law.
- OCR runs in the browser (Tesseract, Arabic + French). Classification and field extraction are heuristics
  that always end in human review.
- E-mail (password reset links, reminders) works only when an SMTP server is configured; otherwise the
  interface says it is not configured. **SMS is not implemented.**
- Demo modules do not share data with the server and do not sync across devices.
- Not yet set: a strict Content-Security-Policy (the demo archive loads its OCR engine from a CDN) and
  data-retention policies.

## 7. Where to go next

| I want to… | Read |
|---|---|
| Log in and look around | [README.md](../README.md#try-it--test-accounts) |
| Use each screen | [USER_GUIDE.md](USER_GUIDE.md) |
| Understand who can do what | [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md) |
| Test the platform properly | [TESTING_GUIDE.md](TESTING_GUIDE.md) |
| Understand the look, feel and responsive behaviour | [UI_AND_DESIGN.md](UI_AND_DESIGN.md) |
| Install, configure or deploy | [README_BACKEND.md](../README_BACKEND.md) |
| Integrate with the API | [API.md](API.md) |
