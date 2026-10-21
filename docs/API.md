# API reference — `/api/v1` and `/api/auth`

Types referenced below (`CaseSummaryDTO`, `PaymentDTO`, …) are defined in
[`shared/api.ts`](../shared/api.ts), which both the server and the web client import.

## Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1` (office API), `/api/auth` (authentication, allow-listed Better Auth endpoints) |
| Authentication | Session cookie set by `POST /api/auth/sign-in/email` (httpOnly, `SameSite=Lax`). The office, user and role always come from the session — never from the request. |
| CSRF | Every `POST/PATCH/PUT/DELETE` must send an `Origin` header equal to the public URL's origin (or one in `TRUSTED_ORIGINS`). Browsers do this automatically. |
| Bodies | JSON (`Content-Type: application/json`), maximum 1 MB. Unknown fields are ignored (for example a client-supplied `organizationId` has no effect). |
| Dates / times | Calendar dates `YYYY-MM-DD`; wall-clock times `HH:mm` in the office time zone (`Africa/Tunis` by default); instants are ISO-8601 UTC strings. |
| Money | Decimal strings with up to 3 decimals in requests (`"1500.5"`); responses always use 3 (`"1500.500"`). |
| Pagination | `?page=1&pageSize=20` (max 100; hearings and tasks up to 200). Response `{ items, page, pageSize, total }`. |
| Sorting | `?sort=field:asc|desc`, fields listed per endpoint. |
| Concurrency | Updates send the record's `version`; a stale version returns `409 VERSION_CONFLICT`. |
| Idempotency | `POST /payments` **requires** an `Idempotency-Key` header (8–200 chars `[A-Za-z0-9_.:-]`); `POST /fees` accepts one. Retrying with the same key and body returns the original result (`200`, header `Idempotent-Replayed: true`); the same key with a different body returns `409 IDEMPOTENCY_KEY_REUSED`. |
| Request id | Every response has `X-Request-Id`; error bodies repeat it. |

### Errors

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "يرجى إدخال اسم الحريف",
             "details": [{ "path": "fullName", "message": "يرجى إدخال اسم الحريف" }],
             "data": null, "requestId": "…" } }
```

`message` is Arabic and safe to display. Codes:

| Status | Codes |
|---|---|
| 400 | `IDEMPOTENCY_KEY_REQUIRED` |
| 401 | `UNAUTHENTICATED` (no / expired session) |
| 403 | `FORBIDDEN` (role), `NO_ACTIVE_OFFICE`, `CSRF_REJECTED` |
| 404 | `NOT_FOUND` — also returned for records of other offices or files the user may not see |
| 409 | `CONFLICT`, `VERSION_CONFLICT`, `HEARING_CONFLICT` (`data`: `HearingConflictsDTO`), `TASK_CONFLICT` (`data`: `TaskConflictsDTO`), `IDEMPOTENCY_KEY_REUSED`, `IMMUTABLE_RECORD` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `VALIDATION_FAILED` (`details` per field), `OVERPAYMENT` (`data.remaining`) |
| 429 | `RATE_LIMITED` (`Retry-After` header) |
| 500 / 503 | `INTERNAL` (no internals disclosed), `SERVICE_UNAVAILABLE` (database / PDF engine unavailable) |

## Authentication — `/api/auth`

Only these Better Auth endpoints are exposed (all others return 404). Responses never contain the
session token.

| Endpoint | Body | Notes |
|---|---|---|
| `POST /sign-in/email` | `{ email, password, rememberMe? }` | `200 { user }`, or `200 { twoFactorRedirect: true }` when TOTP is enabled. `401` wrong credentials (same answer for unknown accounts), `403 ACCOUNT_DISABLED`, `429` rate limit / account lockout. |
| `POST /two-factor/verify-totp` | `{ code, trustDevice? }` | Completes sign-in (or confirms enrolment). |
| `POST /two-factor/verify-backup-code` | `{ code }` | Sign-in with a backup code. |
| `POST /two-factor/enable` | `{ password }` | `{ totpURI, backupCodes }`; confirm with `verify-totp`. |
| `POST /two-factor/disable` | `{ password }` | |
| `POST /two-factor/get-totp-uri`, `/two-factor/generate-backup-codes` | `{ password }` | |
| `POST /sign-out` | `{}` | |
| `GET /get-session` | — | Session metadata (token removed). Prefer `GET /api/v1/me`. |
| `POST /request-password-reset` | `{ email, redirectTo }` | `200` for every address when SMTP is configured (a one-hour link is sent if the account exists). Without SMTP: `503 SERVICE_UNAVAILABLE`, also identical for every address. |
| `GET /reset-password/:token` | — | Link target; redirects to `redirectTo?token=…`. |
| `POST /reset-password` | `{ token, newPassword }` | Revokes all sessions. |
| `POST /change-password` | `{ currentPassword, newPassword, revokeOtherSessions? }` | |
| `POST /revoke-other-sessions` | `{}` | |

## Office API — `/api/v1`

Permissions are described in README_BACKEND.md §6. "Scoped" means the result only contains records
the user may see.

### Identity and members

| Endpoint | Description |
|---|---|
| `GET /me` | `MeDTO`: user, active office (time zone, currency), role, server-computed permissions, offices, `mail.configured`. |
| `POST /me/active-office` | `{ organizationId }` — switch office (active membership required). |
| `GET /me/sessions` | `SessionDTO[]` of the current user (no tokens). |
| `DELETE /me/sessions/:id` | End another session of the current user (`409` for the current one: use sign-out). |
| `GET /members?includeInactive=true` | Active colleagues (for pickers); administrators may include deactivated members. |

### Dashboard

`GET /dashboard` → `DashboardDTO` (scoped): active cases, hearings in the next 7 days (office time),
today's tasks, overdue count, conflict groups, case-type distribution, recent cases, and outstanding
amounts per currency (`null` without finance permission).

### Clients

| Endpoint | Description |
|---|---|
| `GET /clients?q=&type=&archived=true|false&page=&pageSize=&sort=fullName|createdAt|updatedAt:asc|desc` | Scoped list. `q` is Arabic-normalised (أ/إ/آ→ا, ة→ه, ى→ي, diacritics removed) over name, phone, e-mail, national id. |
| `POST /clients` | `{ type, fullName, phone?, email?, address?, nationalId?, notes? }` → `201 ClientDTO`. |
| `GET /clients/:id` | `ClientDetailDTO` with the files the user may see. |
| `PATCH /clients/:id` | Partial fields + `version`. |
| `POST /clients/:id/archive`, `/unarchive` | `{ version }` — non-destructive. |

`type`: `INDIVIDUAL | COMPANY | HEIRS | ADMINISTRATION | OTHER`.

### Cases

| Endpoint | Description |
|---|---|
| `GET /cases?q=&status=&type=&lawyerId=&clientId=&page=&pageSize=&sort=reference|openedOn|updatedAt:asc|desc` | Scoped list of `CaseSummaryDTO` (with next scheduled hearing). `q` searches reference, court, description and client names. |
| `POST /cases` | `{ reference, type, status?, court, chamber?, description?, openedOn?, assignedLawyerId, clientIds?: [] , newClient?: {…}, memberIds?: [] }` → `201 CaseDetailDTO`. Reference unique per office (`409`). The lawyer must be an active lawyer/admin of the office. A clerk creating a file is added to its staff. Non-`ACTIVE` status or other staff members need `case:status` / `case:assign`. |
| `GET /cases/:id` | `CaseDetailDTO`, including `can` flags computed for the current user. |
| `PATCH /cases/:id` | `{ reference?, type?, court?, chamber?, description?, version }`. |
| `POST /cases/:id/status` | `{ status: ACTIVE|POSTPONED|CLOSED, closedOn?, version }` (lawyer/admin). |
| `POST /cases/:id/assign` | `{ assignedLawyerId, version }` (lawyer/admin). |
| `PUT /cases/:id/members` | `{ userIds: [], version }` (lawyer/admin). |
| `POST /cases/:id/clients` | `{ clientId, role?: PRINCIPAL|CO_CLIENT|REPRESENTATIVE, version }`. |
| `DELETE /cases/:id/clients/:clientId` | `{ version }`; the last client cannot be removed. |
| `GET /cases/:id/notes`, `POST /cases/:id/notes` | `{ content }`. Note text is never copied to the audit log. |
| `GET /cases/:id/timeline` | `TimelineEntryDTO[]` from the audit log (financial entries only for finance roles). |

`type`: `INHERITANCE | CIVIL | CASSATION | COMMERCIAL | REAL_ESTATE | CRIMINAL | ADMINISTRATIVE | LABOR | FAMILY | OTHER`.

### Hearings

| Endpoint | Description |
|---|---|
| `GET /hearings?from=&to=&caseId=&status=&page=&pageSize=` | Scoped; `from`/`to` are calendar dates in office time. Sorted by start. |
| `POST /hearings` | `{ caseId, date, time, durationMinutes? (5–1440, default 60), court, chamber?, room?, type, notes?, acknowledgeConflicts? }` → `201 HearingDTO`. The time is mandatory. Closed files are refused. Overlap with another scheduled hearing of the same lawyer → `409 HEARING_CONFLICT` unless `acknowledgeConflicts: true`. |
| `GET /hearings/conflicts?caseId=&date=&time=&durationMinutes=&excludeId=` | Preview: `HearingConflictsDTO` (`hiddenCount` = clashes in files the user cannot see). |
| `GET /hearings/conflict-groups` | Upcoming overlapping groups among visible hearings. |
| `GET /hearings/:id` | `HearingDTO`. |
| `PATCH /hearings/:id` | Partial fields + `reason?`, `acknowledgeConflicts?`, `version`. Changing date/time/duration records a `RESCHEDULED` event (before/after) and cancels pending reminders for the hearing. Only scheduled hearings can be edited. |
| `POST /hearings/:id/status` | `{ status: HELD|POSTPONED|CANCELLED, reason?, next?: { date, time }, acknowledgeConflicts?, version }`. Reason required to postpone or cancel; cancelling needs `hearing:cancel`. `next` creates the follow-up hearing. Returns `{ hearing, next }`. |
| `GET /hearings/:id/history` | `HearingEventDTO[]` (append-only). |

### Fees, payments, receipts (finance permissions)

| Endpoint | Description |
|---|---|
| `GET /fees?caseId=&status=&page=&pageSize=` | `FeeAgreementDTO` with `paid`, `remaining`, `settlement` (`PAID|PARTIAL|UNPAID`). |
| `POST /fees` | `{ caseId, clientId?, title?, amount, currency?, paymentTerms? }`, optional `Idempotency-Key` → `201`. The client must be linked to the file (defaults to the file's only client). |
| `GET /fees/totals` | `FinanceTotalsDTO[]` per currency (agreed, paid, remaining, unsettled count). |
| `GET /fees/:id` | `FeeAgreementDetailDTO` including every payment (voided ones too). |
| `PATCH /fees/:id` | `{ title?, amount?, paymentTerms?, version }`; the amount cannot go below what was received. |
| `POST /fees/:id/cancel` | `{ reason, version }`; refused while recorded payments exist. |
| `GET /payments?agreementId=&caseId=&status=&from=&to=&page=&pageSize=` | `PaymentDTO` list. |
| `POST /payments` | **`Idempotency-Key` required.** `{ agreementId, amount, paidOn, method, reference?, notes? }` → `201 RecordPaymentResultDTO` (`payment` with its `receipt`, updated `agreement`). `paidOn` cannot be in the future; `CHECK` / `BANK_TRANSFER` need `reference`; amount above the remaining balance → `422 OVERPAYMENT`; same cheque/transfer reference twice on one agreement → `409`. The receipt's `pdf.available` is `true` only if the PDF was really generated; otherwise `pdf.error` explains why. |
| `GET /payments/:id` | `PaymentDTO`. |
| `POST /payments/:id/void` | `{ reason }` (lawyer/admin). Marks the payment `VOIDED`, cancels its receipt, restores the balance. |
| `GET /receipts?caseId=&status=&number=&from=&to=&page=&pageSize=` | `ReceiptDTO` list, newest number first. |
| `GET /receipts/:id` | `ReceiptDTO`. |
| `GET /receipts/:id/pdf?download=1` | `application/pdf`. Issued receipt: the stored original (`X-Receipt-Status: ISSUED`). Cancelled receipt: a copy rendered on demand and stamped «وصل ملغى». No PDF yet → `409` with `data.pdfError`. |
| `POST /receipts/:id/pdf` | Retry PDF generation for an issued receipt without one (write-once). |

`method`: `CASH | CHECK | BANK_TRANSFER | CARD | MOBILE | OTHER`.

### Tasks and reminders

| Endpoint | Description |
|---|---|
| `GET /tasks?bucket=today|upcoming|overdue|done&assigneeId=me|<id>&caseId=&q=&page=&pageSize=` | Scoped `TaskDTO` list; buckets use the office's calendar day. Cancelled tasks are excluded. |
| `GET /tasks/summary?assigneeId=&caseId=` | `{ today, upcoming, overdue, done }`. |
| `GET /tasks/conflicts?assigneeId=&dueDate=&dueTime=&excludeId=` | Same-hour tasks of that person and their overlapping hearings. |
| `POST /tasks` | `{ kind?: TASK|REMINDER, title, description?, caseId?, hearingId?, assigneeId, dueDate?, dueTime?, priority?, recurrence?: NONE|DAILY|WEEKLY|MONTHLY, notifyInApp?, notifyEmail?, acknowledgeConflicts? }`. A time requires a date; without a time no reminder is scheduled. One reminder row is created per requested channel at the due instant. Clash → `409 TASK_CONFLICT` unless acknowledged. |
| `GET /tasks/:id`, `PATCH /tasks/:id` | Update (open tasks only) with `version`; rescheduling re-creates pending reminders. |
| `POST /tasks/:id/complete` | `{ version }` → `{ task, next }`; a recurring task creates its next occurrence exactly once. |
| `POST /tasks/:id/reopen`, `/cancel` | `{ version }`; cancel is the non-destructive "delete". |
| `GET /reminders?status=&page=&pageSize=` | The current user's reminders with delivery state. |
| `GET /reminders/inbox` | Delivered, unread in-app reminders `{ items, unread }`. |
| `POST /reminders` | `{ hearingId, minutesBefore?, channel?: IN_APP|EMAIL }` — personal reminder for a hearing. |
| `POST /reminders/:id/read` | Acknowledge (recipient only). |
| `POST /reminders/:id/cancel` | Cancel a pending reminder (recipient, creator or admin). |

Reminder status: `PENDING → SENT`, or `FAILED` (after 3 e-mail attempts with back-off), `CANCELLED`
(task closed, hearing changed, member deactivated, preference off, or more than 12 h late), or
`NOT_CONFIGURED` (e-mail requested but no SMTP — never reported as sent).

### Settings and audit

| Endpoint | Description |
|---|---|
| `GET /settings` | `{ office, preferences, profile }`. |
| `PATCH /settings/office` | Admin. Legal name, contacts, tax id, bar registration, time zone, default currency, file-visibility and clerk-payment policies. |
| `PATCH /settings/preferences` | Own notification preferences. |
| `PATCH /settings/profile` | Own `{ name?, phone?, barNumber? }`. |
| `GET /settings/members` | Admin: all members including deactivated. |
| `POST /settings/members` | Admin: `{ name, email, role: admin|lawyer|clerk, password, phone?, barNumber? }`. |
| `PATCH /settings/members/:userId` | Admin: `{ role }`. Not your own role; the last active admin is protected; a lawyer with open files cannot become a clerk. |
| `POST /settings/members/:userId/deactivate`, `/reactivate` | Admin. Deactivation ends the member's sessions; history is kept. |
| `POST /settings/members/:userId/password` | Admin: `{ password }`; ends the member's sessions. |
| `GET /settings/audit?resourceType=&actorId=&outcome=&from=&to=&page=&pageSize=` | Admin: the office's append-only audit log. |

### Health

`GET /api/health` → `200 { status: "ok", database: "ok" }` or `503 { status: "degraded", database: "unavailable" }`.
