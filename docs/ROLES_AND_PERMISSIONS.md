# Roles and permissions

The platform has **two separate role systems**. Knowing which one you are looking at avoids most
confusion when testing.

| | Real roles (server) | Demo roles (browser) |
|---|---|---|
| Used by | Everything backed by the server: clients, cases, hearings, tasks, fees, settings | Assistant, smart archive, approvals |
| Comes from | The account you **sign in with** | A selector in **Settings → الدور والصلاحيات (الوحدات التجريبية)** |
| Enforced by | The server, on every request | The in-browser service layer (prototype) |
| Roles | Administrator · Lawyer · Clerk | Lawyer (owner) · Associate · Secretary · Accountant · Administrator |

Switching the demo identity never changes what the server lets you do.

---

## 1. Test accounts

All accounts share the password **`adala12345`** (development data only — see the security note in the
[README](../README.md#try-it--test-accounts)).

| Role | Name | E-mail | Office |
|---|---|---|---|
| Administrator | هالة الماجري | `h.majri@ayari.example` | مكتب الأستاذ منير العياري للمحاماة |
| Lawyer | الأستاذ منير العياري | `m.ayari@ayari.example` | same |
| Lawyer | الأستاذة سلمى الحداد | `s.haddad@ayari.example` | same |
| Clerk | أمينة الزواري | `a.zouari@ayari.example` | same |
| Administrator (second office) | الأستاذة ريم الشريف | `r.cherif@cherif.example` | مكتب الأستاذة ريم الشريف للمحاماة |

## 2. Real roles — what each can do

The server resolves identity, office and role from the session on every request. The browser cannot claim
a role.

| Capability | Administrator | Lawyer | Clerk |
|---|:-:|:-:|:-:|
| Read and write clients | ✓ | ✓ | ✓ |
| Read and create cases, edit case details, add notes | ✓ | ✓ | ✓ |
| Schedule and edit hearings, create tasks and reminders | ✓ | ✓ | ✓ |
| **Change case status** (active / postponed / closed) | ✓ | ✓ | — |
| **Reassign the lawyer / edit file staff** | ✓ | ✓ | — |
| **Cancel a hearing** | ✓ | ✓ | — |
| See finances (fees page, a file's fees tab, "unpaid dues" on the dashboard) | ✓ | ✓ | only if the office enables it |
| Record a payment and issue a receipt | ✓ | ✓ | only if the office enables it |
| Create and manage fee agreements | ✓ | ✓ | — |
| **Void a payment** | ✓ | ✓ | — |
| **Office settings** (name, address, tax data, rules below) | ✓ | — | — |
| **Members** (add, change role, deactivate, set a new password) | ✓ | — | — |
| **Office audit log** | ✓ | — | — |

In numbers: an administrator holds 18 permissions, a lawyer 15, a clerk 8 (10 if the office lets clerks
record payments). When an action is refused the interface shows an Arabic message naming the rule, for
example «تغيير حالة القضية مقصور على المحامين ومدير المكتب».

## 3. Which files a person sees

Permission to *do* something and permission to *see* a file are separate. Visibility is decided by the
office's rules, set by the administrator in **Settings → المكتب**:

| Office rule | Default | Effect |
|---|:-:|---|
| المحامون يرون كل ملفات المكتب — lawyers see all files | on | Off: a lawyer sees only files assigned to them or where they are on the staff. |
| الكتبة يرون كل ملفات المكتب — clerks see all files | off | Off: a clerk sees only files where they are on the staff. |
| الكتبة يسجّلون الدفعات — clerks may record payments | off | On: clerks can see finances, record payments and issue receipts (not void them). |

- **Administrators** always see every file of their own office — and nothing of any other office.
- Related data follows the file: a file's **hearings, fees, payments and receipts** are visible exactly
  to the people who see the file. **Tasks** follow their file; a task with no file is visible to its
  assignee and creator (and administrators). **Clients** are visible through their files (or if you created
  them, or they are not on any file yet).
- A record you may not see answers as "not found", never "forbidden", so its existence is not revealed.

### What each test account sees in the demo data

The first office deliberately runs with «المحامون يرون كل ملفات المكتب» **off**, so you can see scoping at
work:

| Account | Sees |
|---|---|
| هالة الماجري (administrator) | All 6 files of the first office, including the confidential one; all fees; members; audit log. Nothing of the second office. |
| منير العياري (lawyer) | The 5 files assigned to him. **Not** the confidential file `CC/2025/0977`. |
| سلمى الحداد (lawyer) | `CC/2025/0398` (she is on its staff) and her own confidential file `CC/2025/0977`. |
| أمينة الزواري (clerk) | The 5 files where she is on the staff. No fees (the clerk payment rule is off). Not the confidential file. |
| ريم الشريف (administrator, second office) | Only her office's single file. It has the same reference as a file in the other office (`CC/2025/0124`) — references are unique per office, and the two never mix. |

## 4. Managing members (administrator)

**Settings → أعضاء المكتب**:

- **Add a member** — name, e-mail, role and an initial password of at least 10 characters.
- **Change a role** — takes effect on the member's next request.
- **Deactivate / reactivate** — members are never deleted: a deactivated member cannot sign in or act, and
  the history they created stays intact.
- **Set a new password** — the way to recover access when the office has no e-mail server configured.

Public sign-up does not exist; only administrators create accounts.

## 5. Demo-module roles (assistant, archive, approvals)

These modules identify you with a **demo team member** chosen in Settings. They exist to demonstrate the
approval workflow.

| Demo role | Person | Can do |
|---|---|---|
| Lawyer — owner (محامٍ صاحب المكتب) | منير العياري | Everything, including finance, audit log, archive processing, office approval policy |
| Associate (محامية مساعدة) | سلمى الحداد | Read and write notes, hearings, tasks; read finance; link documents; process the archive |
| Secretary (كاتبة المكتب) | أمينة الزواري | Hearings, tasks, link documents, process the archive |
| Accountant (مسؤول مالي) | كريم بن عمر | Read and write finance, tasks |
| Administrator (مديرة المكتب) | هالة الماجري | Hearings, tasks, link documents, archive, audit log, approval policy |

In these modules a member sees only the files they are staffed on.

### Who may approve what

The assistant (and any clerk) can only **propose**. These roles may **decide**:

| Proposed operation | May approve |
|---|---|
| Create / change a hearing | Lawyer, Associate |
| Create a task or reminder | Lawyer, Associate, Administrator |
| Draft a payment reminder · issue a receipt | Lawyer, Accountant |
| Link a document to a case | Lawyer, Associate |
| Verify an archived document | Lawyer, Associate |
| Finalize an archived document | Lawyer, Administrator |

The Secretary may also approve hearings, tasks, reminders and document links **when the office switches
off** «مقترحات الكتبة تتطلب موافقة محامٍ» (Settings → سياسة الموافقات). Financial operations and final
archiving always stay with the roles above.

Safety rules that hold in every case: an approval is bound to the exact parameters it was shown (any change
makes it stale), a request runs at most once, and nobody — including the AI — can approve their own
proposal implicitly.
