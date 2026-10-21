# Testing guide

How to try the platform properly, account by account. Each scenario says what to do and what you should
see. Tick the boxes as you go.

**Accounts** (password for all: `adala12345`):

| Role | E-mail |
|---|---|
| Administrator | `h.majri@ayari.example` |
| Lawyer (منير) | `m.ayari@ayari.example` |
| Lawyer (سلمى) | `s.haddad@ayari.example` |
| Clerk (أمينة) | `a.zouari@ayari.example` |
| Administrator, second office | `r.cherif@cherif.example` |

---

## 0. Before you start

**Start the app** (first-time database setup is in [README_BACKEND.md](../README_BACKEND.md#3-local-setup)):

```bash
npm run db:local -- start   # PostgreSQL, if you use the project-local one
npm run dev:server          # API on :3001
npm run dev                 # web app on http://localhost:8080
```

**To test two people at once** use two different browsers, or one normal and one private window; a session
is tied to the browser profile.

**Seed data.** The first office has five files plus one confidential file, six hearings in total (two of
them deliberately overlapping), fee agreements, and four tasks. Dates are relative to the day the database
was seeded: if the database was seeded days ago, "today's" tasks and the nearest hearings have moved on
(for example a task due on the seed day now sits under **المتأخرة**), and anything you complete or edit
stays changed. For the intended picture use a freshly seeded database (see §10).

| File | Type · client | Notes |
|---|---|---|
| `CC/2025/0124` | Inheritance · عائلة بن صالح | fees 3500 — fully paid |
| `CC/2025/0398` | Civil · سامي مراد | fees 5000 — 2000 paid, **3000 due**; منير's reminder to call the client |
| `CC/2024/0512` | Cassation · الهادي الطرابلسي | fees 8000 — **nothing paid**; منير's overdue task |
| `CC/2025/0842` | Commercial · شركة المتوسط للتجارة | fees 6000 — fully paid; **overlaps** with 0512 |
| `CC/2025/0211` | Real estate · ليلى الشابي | status *postponed*; fees 2500 — fully paid |
| `CC/2025/0977` | Inheritance · ورثة القروي | **confidential — only سلمى (and the administrator)**; fees 4000, 1000 paid |

> **Careful with shared accounts.** If several people use the same accounts, do not enable two-factor
> authentication on them (others cannot get the code) and do not change their password — or change it
> back. Re-running `npm run db:seed` re-applies `adala12345` to all five accounts if anyone gets locked out.

---

## 1. Sign-in and sessions (any account)

- [ ] Wrong password → an Arabic error, and the same message for a wrong e-mail (no hint which was wrong).
- [ ] Correct sign-in → dashboard. The bottom of the menu shows your name, role and office.
- [ ] Open `http://localhost:8080/app/cases` in a window that is not signed in → redirected to the sign-in
      page.
- [ ] Sign out → going Back in the browser does not show private pages.
- [ ] **نسيت كلمة المرور؟** → says e-mail is not configured (expected without an SMTP server).
- [ ] Rate limit: five or more sign-ins within a minute return "429" — wait a minute. Ten wrong passwords
      lock that account for 15 minutes.

## 2. Administrator — هالة الماجري

- [ ] **Dashboard:** *5* active cases (six files, one postponed). A red conflict banner about two hearings.
- [ ] **القضايا:** *6 قضية*, including `CC/2025/0977`.
- [ ] **الأتعاب:** all six agreements. Still due: 3000 (0398) + 8000 (0512) + 3000 (0977) = **14 000 TND**.
- [ ] **الإعدادات → أعضاء المكتب:** four members. Add a member (any name, a new e-mail, role *clerk*,
      password of at least 10 characters) → the member can sign in. Change their role → their menu and
      permissions change on the next request. **Set a new password.** **Deactivate** → they can no longer sign
      in, and nothing of their history disappears.
- [ ] A password shorter than 10 characters is refused with an Arabic message.
- [ ] **الإعدادات → المكتب:** change the address → a new receipt shows it. Switch on
      «الكتبة يسجّلون الدفعات», then see §5.
- [ ] **سجل عمليات الخادم:** every action you just did is listed, with who, when and a short Arabic summary.
      No passwords or note contents appear.
- [ ] You do **not** see any file of the second office.

## 3. Lawyer — منير العياري

**Scope**
- [ ] **القضايا** shows 5 files. Searching `0977` finds nothing.
- [ ] Dashboard: *4* active cases; **مستحقات غير مدفوعة** = 3000 + 8000 = **11 000 TND**.

**Hearings and conflicts**
- [ ] The dashboard banner links to **الجلسات**: an alert names `CC/2025/0512` and `CC/2025/0842`, same
      lawyer, same date, 09:00. Both chips are red in the calendar.
- [ ] **إضافة جلسة** on another file, at the same date and time as an existing hearing → a conflict warning
      appears. **حفظ** is refused until you tick «أؤكد البرمجة رغم التعارض»; then it saves and the alert
      shows on the page.
- [ ] On a hearing's menu (⋮): **تعديل الموعد**, **انعقدت الجلسة**, **تأجيل** (optionally creating the next
      hearing), **إلغاء الجلسة** (a reason is required), **سجل الجلسة** (every change with old and new time).
- [ ] A time that does not exist in Tunisian time is rejected, not silently shifted.

**Calendar** (see [UI_AND_DESIGN.md](UI_AND_DESIGN.md))
- [ ] The month grid fills the width; chips are red / gold / grey by urgency; the list sits beside it.
- [ ] Previous / next month and **اليوم** work. Clicking a day filters the list; clicking again clears it.
- [ ] Clicking a chip opens the file.

**Files and clients**
- [ ] **قضية جديدة** with a new client → appears in the list, and in **الحرفاء**.
- [ ] In the file: change the status to *مؤجلة* → a new line appears in **السجل الزمني**.
- [ ] Add a **note**; add a **task** from the file's **المهام** tab.

**Money**
- [ ] Open **الأتعاب** → file `CC/2025/0398`: status **جزئي**, 3000 due. **وصل** → amount `3000` → confirm →
      status **مسدّد** and a receipt `REC-YYYY-NNNNNN` with a PDF.
- [ ] Try paying more than the balance → refused.
- [ ] **سجل الدفعات → إلغاء دفعة** with a reason → payment marked *ملغاة*, receipt stamped *ملغى*, balance
      back to 3000. Nothing was deleted.

**Tasks**
- [ ] **المتأخرة** holds «مراجعة مذكرة الطعن قبل الإيداع» (due the day before the seed day). Tick it → it
      moves to **المنجزة**.
- [ ] Create a *monthly* recurring task with a due date, complete it → the next occurrence appears.

## 4. Lawyer — سلمى الحداد

- [ ] **القضايا** shows exactly two files: `CC/2025/0398` and `CC/2025/0977` (confidential).
- [ ] Her hearing for `CC/2025/0977` appears in **الجلسات**. **الأتعاب** shows two agreements — `0398`
      (3000 due) and her confidential `0977` (4000, 1000 paid, 3000 due) — so the dashboard's unpaid dues
      read **6 000 TND**. She sees no conflict banner: the overlap involves منير's other files.
- [ ] Sign in as منير in the other browser: that hearing and that fee are **not** visible to him, and
      opening a link to the file directly says it is unavailable.
- [ ] Sign in as the administrator: all of it is visible.

## 5. Clerk — أمينة الزواري

**Can**
- [ ] Open a file, add a note, create a client and a case, schedule a hearing, create a task.
- [ ] **المهام** shows what is assigned to her or linked to files she works on — in the seed,
      «طلب شهادة ملكية محيّنة», due on the seed day (under **اليوم**, or **المتأخرة** once that day has passed,
      unless someone already completed it).

**Cannot**
- [ ] In a file, the status is shown read-only (no selector). The hearing menu has no **إلغاء**.
- [ ] **الأتعاب** shows «غير مصرّح». No fees tab in a file. No "unpaid dues" card on the dashboard.
- [ ] **الإعدادات**: the **المكتب** card is read-only («يعدّلها مدير المكتب فقط»), and there is no
      **أعضاء المكتب** or **سجل عمليات الخادم** card.

**Then let the administrator change the rule**
- [ ] Administrator: Settings → المكتب → switch on «الكتبة يسجّلون الدفعات».
- [ ] Clerk (reload): **الأتعاب** is now available and she can record a payment and issue a receipt — but
      **cannot void** one. Switch the rule off again afterwards.

## 6. Second office — ريم الشريف

- [ ] Sees one file only: `CC/2025/0124` (labor, محمد الفراتي). The first office's file with the same
      reference (an inheritance dispute) is not reachable from here, and she sees none of its hearings,
      clients, fees or members.
- [ ] Her member list contains only herself.

## 7. Look and behaviour (any account)

- [ ] **Desktop menu on a short window:** make the browser window about 600 px tall → the whole menu fits,
      the user card stays visible at the bottom. Make it shorter → the list scrolls on its own, fades at the
      edge that continues, and the current section stays in view.
- [ ] **Navigation:** scroll down a long page, click another menu item → the new page starts at the top.
      Browser **Back** returns you to the previous position.
- [ ] **Phone** (browser developer tools → device toolbar, about 390 px wide): bottom bar appears; the
      desktop menu is gone; **المزيد** opens the rest; the agenda shows a week strip, and **عرض الشهر** shows
      the month with dots; no sideways scrolling anywhere.
- [ ] **Settings → المظهر والتفضيلات:** dark theme and the three text sizes change the whole interface,
      including the calendar and the menu.
- [ ] **Ctrl + K** focuses quick search.

## 8. Demo modules (assistant, archive, approvals)

These keep their data in the browser; nothing here appears on the server.

- [ ] **المساعد:** click a suggested question, e.g. «شنوة الجلسات اللي عندي الأسبوع الجاي؟» → an answer
      labelled «تجريبي» with citations.
- [ ] **Approval flow:** Settings → *الدور والصلاحيات (الوحدات التجريبية)* → choose **أمينة الزواري**. In the
      assistant write «سجّللي جلسة نهار 11 نوفمبر مع ملف عائلة بن صالح على الساعة 10». It shows a preview and
      writes nothing. Confirm → an approval request. Switch to **منير العياري** → **طلبات الموافقة** → approve →
      only now is the hearing created (in the demo store).
- [ ] **Archive:** الأرشفة الذكية → new batch → upload a scanned page or photo → text is extracted (the first
      run downloads the OCR engine and Arabic/French models, so it needs internet) → review → match a case →
      finalize (needs approval).
- [ ] **Search:** find a word from the document you archived; open the viewer with highlights.
- [ ] **Chat scrolling:** build a long conversation (send four or five of the suggested questions). The
      message box stays pinned at the bottom and only the conversation scrolls. While an answer is being
      written the view follows it; scroll up even a little and it stops following, and a **رد جديد** button
      appears — click it to return. Scroll far up and send a message → you are taken straight to it and the
      answer. Open another conversation from the history list → it opens at its latest message. Make the
      message box taller (Shift + Enter for new lines) → the latest message stays in view.
- [ ] **Settings → البيانات التجريبية → إعادة البيانات التجريبية** restores the demo store.

## 9. Things that are not bugs

- «تجريبي» labels and the **وضع تجريبي** button: the assistant, archive and approvals are simulated.
- Forgot-password says e-mail is not configured; the administrator sets a new password instead.
- SMS reminders are "not available"; e-mail reminders need an SMTP server.
- Records created by the assistant do not show in server-backed screens (cases, agenda, fees), and the
  reverse.
- Seed dates move with the day you seeded; hearings in the past stay in the past.

## 10. Resetting

- Re-run `npm run db:seed` to re-apply the seed password. It does **not** undo changes to data.
- To start from scratch, recreate the development database (see
  [README_BACKEND.md](../README_BACKEND.md#31-database)) and run `npm run db:seed` again.

## 11. Automated tests

```bash
npm run test:run          # components and logic (Vitest, jsdom)
npm run test:server       # API against a real PostgreSQL test database
npm run test:e2e          # real browser: sign-in, cases, hearings and conflicts, payments and PDF, phone
npm run typecheck && npm run lint
npm run check:protected   # guards the demo modules' files against unintended edits
```

`test:server` and `test:e2e` use a separate database whose name contains `test`; they refuse to run
against anything else and never touch the development data.

## 12. Reporting a problem

Please include: the account you used, the page, what you did step by step, what you expected, what
happened, a screenshot, the time, and — if an error message appears — its **request id** (shown with the
error), which lets a developer find the exact request in the server log.
