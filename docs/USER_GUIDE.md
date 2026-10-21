# User guide

A screen-by-screen guide for daily use. Names in Arabic are exactly as they appear in the interface. To
follow along, sign in with one of the [test accounts](../README.md#try-it--test-accounts). What you can
see and do depends on your role: see [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md).

Screens marked **(demo)** run inside your browser and are labelled «تجريبي»; what they create is not
stored on the office server.

---

## Getting around

- **Desktop:** the menu is on the right (the interface is right-to-left). It shows the section you are in,
  and keeps your name, role and **تسجيل الخروج** (sign out) pinned at the bottom. On a short window the
  menu list scrolls by itself, fades at the edges that continue, and keeps the current section in view.
- **Phone / tablet:** a bottom bar with الرئيسية، القضايا، المساعد، الجلسات and **المزيد** (everything else).
  Full-screen pages such as the assistant use a menu button at the top instead.
- **Quick search** (top bar, or press **Ctrl + K**): searches the document archive.
- **The bell** gathers what needs attention: reminders that are due, hearings coming soon, hearing conflicts,
  and tasks due today or overdue.
- **Light / dark theme and text size:** Settings → المظهر والتفضيلات.
- The **وضع تجريبي** button explains what is real and what is simulated in this version.

## Signing in

1. Enter your e-mail and password → **تسجيل الدخول**.
2. If two-factor authentication is on, enter the 6-digit code from your authenticator app, or one of your
   backup recovery codes.
3. **نسيت كلمة المرور؟** sends a reset link by e-mail — but only if the office has an e-mail server
   configured. Otherwise ask your office administrator to set a new password (Settings → أعضاء المكتب).
4. Sessions last 12 hours; after that you are asked to sign in again. Ten wrong passwords lock the account
   for 15 minutes.

---

## لوحة التحكم — Dashboard

A snapshot of the office, for the person who is signed in:

- **Cards:** active cases · hearings in the next 7 days · today's tasks (with the number overdue) ·
  documents available · **unpaid dues** (shown only to people allowed to see finances).
- A **red banner** appears when two hearings of the same lawyer overlap; click it to open the agenda.
- **مهام اليوم** — today's tasks, which you can tick off here.
- **جلسات الأيام السبعة القادمة** and **قضايا نشطة** — click any row to open the file.
- **المساعد القانوني الذكي** — suggested questions that open the assistant.
- **إجراءات سريعة** — upload a document, search the archive, add a hearing, record a payment, new task.
- **توزيع القضايا** — a chart of your files by type.

## القضايا — Cases

- **Search** by client, reference or court; **filter** by الكل / نشطة / مؤجلة / منتهية.
- **قضية جديدة** opens a form: the client (an existing one, or a new name with its capacity and an optional
  phone), the file reference, type (inheritance, civil, cassation, commercial, real estate, criminal,
  administrative, labor, family, other), court, assigned lawyer, status, an optional first hearing (date and
  time), and a short description.
- On a desktop the list is a table; on a phone it is a list of cards. Large lists are paged.

### A case file (click a case)

Tabs across the top:

| Tab | What it holds |
|---|---|
| نظرة عامة | Summary (type, court, lawyer, dates, description, clients, staff) and the **السجل الزمني** — the file's history, read from the audit log. |
| الوثائق | Archived documents linked to this file (demo archive). |
| الجلسات | Hearings of the file; add one, edit, record the outcome. |
| المهام | Tasks and reminders linked to the file. |
| الأتعاب | The file's fee agreement and payments (only if you may see finances). |
| الملاحظات | Internal notes. |

In the **معلومات القضية** card, lawyers and administrators get a selector to change the **status** (active /
postponed / closed); for a clerk the status is shown read-only (the server also refuses the change). If
someone else edited the file while you had it open, you are told to reload and retry instead of silently
overwriting their change. A closed file no longer offers "schedule a hearing".

## الحرفاء — Clients

Client cards with their linked files. Types: individual, company, heirs (ورثة), administration / public body
(إدارة / هيكل عمومي), other. Open a card to see its details and files or edit it. The **المؤرشفون** toggle
switches between active and archived clients; archiving hides a card, nothing is deleted.

## الجلسات — Hearings and the agenda (المفكرة الذكية)

- **The calendar** is a month grid, Sunday first. Each hearing shows as a chip such as `0842 — 09:00` (the
  end of the file reference and the time). Colour tells urgency: **red = عاجل** (within 48 hours),
  **gold = هذا الأسبوع**, **grey = لاحقاً**. Click a chip to open the file; hover it for the full details.
  A busy day shows "+N أخرى". Today is the gold disc.
- Use the arrows to change month, and **اليوم** to jump back.
- **Click a day** to filter the list beside the calendar to that day; click it again (or **عرض الكل**) to
  clear.
- **جلسات قادمة** lists the hearings with status, room and time. Each has a **تذكير** button (creates a
  reminder the day before) and a menu: **تعديل الموعد**, **انعقدت الجلسة**, **تأجيل** (can create the next
  hearing in the same step), **إلغاء الجلسة** with a reason (lawyers and administrators only), and
  **سجل الجلسة** (every change, with previous and new times).
- **إضافة جلسة** opens the form (court, room, type, date, time, duration). If it overlaps another hearing of
  the same lawyer you get a **conflict warning** and must explicitly tick «أؤكد البرمجة رغم التعارض» to save
  it anyway; conflicts then stay flagged in red on the page and the dashboard.
- **تذكير ذكي** sets the default reminder channels: in-app notification, e-mail (only if the office has an
  e-mail server), SMS (not available).
- On a phone the calendar is a week strip; **عرض الشهر** unfolds the month, where each hearing is a coloured
  dot.

## المهام والتذكيرات — Tasks and reminders

- Tabs: **اليوم**, **القادمة**, **المتأخرة**, **المنجزة**.
- A task has a title, optional file, assignee, due date and time, priority (high / medium / low), and
  recurrence (none / daily / weekly / monthly). A **reminder** is a task that notifies you at its time.
- Tick a task to complete it; completing a recurring task creates the next occurrence automatically.
- A task linked to a file is visible to whoever sees that file; a free-standing task is visible to its
  assignee and creator.

## الأتعاب — Fees and payments

For lawyers and administrators (and clerks, if the office allows):

- Top cards: **إجمالي المقبوض** (collected), **في انتظار الدفع** (still due), **نسبة الاستخلاص** (collection
  rate) and **عدد الملفات غير المسددة** (unsettled files).
- Each **fee agreement** (one per file, with an amount and currency, TND by default) shows its status:
  **مسدّد**، **جزئي**، **غير مدفوع**.
- **اتفاق أتعاب جديد** creates an agreement for a file.
- **وصل / تسجيل دفعة:** enter the amount, method (cash, cheque, bank transfer, card, mobile, other) and
  date → **متابعة** → confirm. The payment and a **numbered PDF receipt** (`REC-YYYY-NNNNNN`) are created
  together. Paying more than the balance is refused; recording the same payment twice is prevented.
  If the PDF could not be rendered the payment still stands and you are told so, with a retry button.
- **سجل الدفعات** lists payments. **إلغاء دفعة** *voids* a payment with a reason — it is never deleted:
  the receipt is stamped «ملغى», the balance is restored, and you may record it again.
- **تذكير بالدفع** creates a reminder to chase an unpaid balance.
- Someone without finance access sees «غير مصرّح» here.

## المساعد القانوني الذكي — Assistant (demo)

Ask in Tunisian dialect or standard Arabic, for example *«شنوة الجلسات اللي عندي الأسبوع الجاي؟»*,
*«حضّرلي ملخص للقضية متاع عائلة بن صالح»*, *«ورّيني الأتعاب اللي مازالت ما تخلّصتش»*.

- It reads only the files you are allowed to see. Replies are generated by rules, labelled «تجريبي», and
  quote documents with page citations.
- When you ask it to *do* something («سجّللي جلسة…»), it shows a **preview** and writes nothing. Confirm it
  and it becomes an **approval request**; it is executed only when a person with the right role approves it
  in طلبات الموافقة.
- Voice dictation (after you consent in Settings) and read-aloud are available where the browser supports
  them. Briefs it prepares can be edited in a document editor.
- **Scrolling:** only the conversation scrolls; the message box stays at the bottom. The view follows an answer
  as it is written. Scroll up to read and it stops following — a **رد جديد** button brings you back. Sending a
  message, or opening another conversation, always takes you to the latest message.

## طلبات الموافقة — Approvals (demo)

Every operation proposed by the assistant or a clerk lands here with the exact parameters, who proposed
it, and who may decide. Approvers can **approve**, **edit then approve**, or **reject**. An approval that no
longer matches the current data is marked stale and must be re-proposed. See
[ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md#5-demo-module-roles-assistant-archive-approvals).

## الأرشفة الذكية — Smart archive (demo)

Turns paper into searchable, verified documents in seven steps: **create a batch** → **upload** (files,
PDF, or camera) → **extract text** (OCR in Arabic, French or mixed, with per-word confidence) →
**classify** → **review** (split screen: scan on one side, extracted fields on the other) → **match a
case** → **finalize** (needs approval). The dashboard shows batches and their states from draft to archived. Originals are stored
write-once and encrypted on your device; the system flags blank or blurry pages, missing pages, and
duplicates but never deletes or merges anything by itself.

## البحث الذكي — Search (demo)

Searches the *verified* archived documents with Arabic-aware matching (letter variants and Arabic/French
synonyms). Open a result in the viewer to read the pages with the matching passages highlighted, jump
between pages, and print.

## الإعدادات — Settings

| Card | For |
|---|---|
| الملف الشخصي | Your name, bar number, e-mail, phone. |
| المكتب | Office name, address, tax data, currency, time zone, and the visibility rules. Editable by the administrator only; printed on receipts. |
| المظهر والتفضيلات | Text size, density, light / dark theme. Stored on this device. |
| الإشعارات | How the server notifies you of reminders. |
| الأمان | **Change password** and **two-factor authentication** (TOTP with backup codes). |
| أعضاء المكتب | Administrator only: add members, change roles, deactivate, set a new password. |
| سجل عمليات الخادم | Administrator only: the append-only record of every operation on office data, including refused attempts. |
| المساعد الذكي والصوت | Voice provider and consent, read-aloud, how long conversations are kept. |
| الدور والصلاحيات (الوحدات التجريبية) | Switch the *demo* identity used by the assistant, archive and approvals. |
| سياسة الموافقات | Whether a clerk's proposals need a lawyer's approval. |
| سجل عمليات الوحدات التجريبية / البيانات التجريبية | The demo modules' local log, and a button to reset their data. |

---

## Tips

- **Scrolling:** the page scrolls normally; long lists inside dialogs and menus scroll on their own. A new
  page always opens at the top, and **Back** returns you to where you were.
- **Printing:** receipts and documents print cleanly; menus and buttons are hidden in print.
- **Phones:** every control is at least 44 px tall; the bottom bar hides while you type so it never floats
  above the keyboard.
- **Nothing happened?** Failed saves are shown as errors in Arabic with a retry; the interface never
  reports success it has not verified.
