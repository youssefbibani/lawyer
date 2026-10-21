/**
 * DEVELOPMENT / TEST SEED ONLY — fictional offices, people and files.
 *
 *   npm run db:seed
 *
 * Refuses to run when NODE_ENV=production. Every record is created through the same services
 * the API uses (validation, authorization, receipt numbering, audit log), so the seed exercises
 * real code paths. E-mail addresses use the reserved ".example" domain.
 */
import { prisma } from "../server/db.js";
import { addDaysToDate, todayIn } from "../server/lib/time.js";
import * as cases from "../server/services/cases.js";
import * as finance from "../server/services/finance.js";
import * as hearings from "../server/services/hearings.js";
import { addUser, createOffice, systemCtx } from "../server/services/offices.js";
import { hashPassword } from "../server/services/settings.js";
import * as tasks from "../server/services/tasks.js";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed: NODE_ENV=production. The seed contains fictional data for development only.");
  process.exit(1);
}

// Deliberately simple so testers can type it anywhere (10 characters is the server's minimum).
// These accounts only exist in development databases: the seed refuses to run in production.
const PASSWORD = process.env.SEED_PASSWORD ?? "adala12345";
const SEED_EMAILS = ["h.majri@ayari.example", "m.ayari@ayari.example", "s.haddad@ayari.example", "a.zouari@ayari.example", "r.cherif@cherif.example"];
const TZ = "Africa/Tunis";
const today = todayIn(TZ);

/** Court working day `offset` days from today (weekends move to Monday). */
function courtDay(offset: number): string {
  let d = addDaysToDate(today, offset);
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  if (dow === 6) d = addDaysToDate(d, 2);
  if (dow === 0) d = addDaysToDate(d, 1);
  return d;
}

/**
 * Offices and accounts are reused when a previous seed run stopped half-way (audit entries are
 * append-only, so a partially created office cannot simply be deleted and recreated).
 */
async function ensureOffice(input: Parameters<typeof createOffice>[0]) {
  const existing = await prisma.organization.findUnique({ where: { slug: input.slug } });
  if (!existing) return createOffice(input);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: input.admin.email } });
  return { organizationId: existing.id, adminUserId: admin.id };
}

async function ensureUser(organizationId: string, user: Parameters<typeof addUser>[1]) {
  const existing = await prisma.user.findUnique({ where: { email: user.email } });
  return existing ? existing.id : addUser(organizationId, user);
}

const hasCases = async (organizationId: string) => (await prisma.case.count({ where: { organizationId } })) > 0;

/**
 * Existing seed accounts keep the password they were created with, so changing the seed password
 * (or SEED_PASSWORD) would otherwise need a database wipe. Re-running the seed re-applies it instead.
 */
async function syncSeedPasswords() {
  const hash = await hashPassword(PASSWORD);
  const { count } = await prisma.account.updateMany({
    where: { providerId: "credential", user: { email: { in: SEED_EMAILS } } },
    data: { password: hash, updatedAt: new Date() },
  });
  console.info(`Seed password applied to ${count} account(s).`);
}

async function seedAyari() {
  const { organizationId, adminUserId } = await ensureOffice({
    name: "مكتب الأستاذ منير العياري للمحاماة",
    slug: "ayari-dev",
    admin: { name: "هالة الماجري", email: "h.majri@ayari.example", password: PASSWORD },
    settings: { address: "نهج الحبيب بورقيبة", city: "تونس", phone: "+216 71 000 000", taxId: "0000000/X/A/M/000", barRegistration: "1287", lawyersSeeAllCases: false },
  });
  if (await hasCases(organizationId)) return console.info("Office ayari-dev already has data: skipped.");
  const mounir = await ensureUser(organizationId, { name: "الأستاذ منير العياري", email: "m.ayari@ayari.example", password: PASSWORD, role: "lawyer", barNumber: "1287" });
  const salma = await ensureUser(organizationId, { name: "الأستاذة سلمى الحداد", email: "s.haddad@ayari.example", password: PASSWORD, role: "lawyer", barNumber: "2391" });
  const amina = await ensureUser(organizationId, { name: "أمينة الزواري", email: "a.zouari@ayari.example", password: PASSWORD, role: "clerk" });

  const asMounir = await systemCtx(mounir, organizationId);
  const asSalma = await systemCtx(salma, organizationId);
  const asAdmin = await systemCtx(adminUserId, organizationId);

  const files = [
    { reference: "CC/2025/0124", type: "INHERITANCE", court: "محكمة التعقيب — الدائرة المدنية", openedOn: "2025-01-15", client: { type: "HEIRS", fullName: "عائلة بن صالح" }, description: "نزاع حول تقسيم تركة عقار موروث وتوزيع الحصص بين الورثة.", members: [amina] },
    { reference: "CC/2025/0398", type: "CIVIL", court: "محكمة التعقيب — الدائرة المدنية", openedOn: "2025-02-03", client: { type: "INDIVIDUAL", fullName: "سامي مراد", phone: "+216 20 000 001" }, description: "نزاع تعاقدي حول تصفية حساب مشترك وتعويض عن أضرار مادية.", members: [amina, salma] },
    { reference: "CC/2024/0512", type: "CASSATION", court: "محكمة التعقيب — الدائرة المدنية", openedOn: "2024-11-20", client: { type: "INDIVIDUAL", fullName: "الهادي الطرابلسي" }, description: "طعن بالتعقيب في قرار استئنافي يتعلق بتنفيذ عقد شراكة.", members: [amina] },
    { reference: "CC/2025/0842", type: "COMMERCIAL", court: "محكمة التعقيب — الدائرة التجارية", openedOn: "2025-03-10", client: { type: "COMPANY", fullName: "شركة المتوسط للتجارة" }, description: "نزاع تجاري حول الإخلال بشروط عقد توريد.", members: [amina] },
    { reference: "CC/2025/0211", type: "REAL_ESTATE", court: "محكمة التعقيب — الدائرة العقارية", openedOn: "2025-04-05", client: { type: "INDIVIDUAL", fullName: "ليلى الشابي" }, description: "نزاع حول حدود ملكية عقار فلاحي، في انتظار تقرير خبرة.", members: [amina] },
  ] as const;

  const ids: string[] = [];
  for (const f of files) {
    const c = await cases.createCase(asMounir, {
      reference: f.reference,
      type: f.type,
      court: f.court,
      openedOn: f.openedOn,
      description: f.description,
      assignedLawyerId: mounir,
      newClient: f.client,
      memberIds: [...f.members],
    });
    ids.push(c.id);
  }
  await cases.changeCaseStatus(asMounir, ids[4], { status: "POSTPONED", version: 1 });
  // A confidential file only its lawyer can see (lawyersSeeAllCases = false in this office).
  const restricted = await cases.createCase(asSalma, {
    reference: "CC/2025/0977",
    type: "INHERITANCE",
    court: "محكمة التعقيب — الدائرة المدنية",
    openedOn: "2025-06-12",
    description: "ملف سرّي تتابعه الأستاذة سلمى الحداد بصفة منفردة.",
    assignedLawyerId: salma,
    newClient: { type: "HEIRS", fullName: "ورثة القروي" },
  });

  await hearings.createHearing(asMounir, { caseId: ids[2], date: courtDay(2), time: "09:00", court: "قصر العدالة بتونس", room: "قاعة 2", type: "جلسة حكم" });
  // Deliberately overlapping, to demonstrate the conflict warning.
  await hearings.createHearing(asMounir, { caseId: ids[3], date: courtDay(2), time: "09:00", court: "قصر العدالة بتونس", room: "قاعة 4", type: "جلسة استماع", acknowledgeConflicts: true });
  await hearings.createHearing(asMounir, { caseId: ids[1], date: courtDay(6), time: "11:30", court: "قصر العدالة بتونس", room: "قاعة 1", type: "جلسة مرافعة" });
  await hearings.createHearing(asMounir, { caseId: ids[0], date: courtDay(11), time: "10:00", court: "قصر العدالة بتونس", room: "قاعة 3", type: "جلسة استماع" });
  await hearings.createHearing(asSalma, { caseId: restricted.id, date: courtDay(9), time: "10:00", court: "قصر العدالة بتونس", room: "قاعة 5", type: "جلسة استماع" });

  const fees: [string, string, string[]][] = [
    [ids[0], "3500", ["1500", "2000"]],
    [ids[1], "5000", ["2000"]],
    [ids[2], "8000", []],
    [ids[3], "6000", ["6000"]],
    [ids[4], "2500", ["2500"]],
  ];
  let n = 0;
  for (const [caseId, amount, payments] of fees) {
    const agreement = await finance.createAgreement(asMounir, { caseId, amount, title: "أتعاب التقاضي" });
    for (const p of payments) {
      n++;
      await finance.recordPayment(asMounir, { agreementId: agreement.id, amount: p, paidOn: addDaysToDate(today, -30 + n * 3), method: n % 2 ? "CASH" : "BANK_TRANSFER", reference: n % 2 ? undefined : `VIR-DEV-${n}` }, `seed-payment-${n}`);
    }
  }
  const restrictedFee = await finance.createAgreement(asSalma, { caseId: restricted.id, amount: "4000" });
  await finance.recordPayment(asSalma, { agreementId: restrictedFee.id, amount: "1000", paidOn: addDaysToDate(today, -10), method: "CASH" }, "seed-payment-restricted");

  await tasks.createTask(asMounir, { title: "طلب شهادة ملكية محيّنة", caseId: ids[0], assigneeId: amina, dueDate: today, dueTime: "15:00", priority: "HIGH" });
  await tasks.createTask(asMounir, { title: "مراجعة مذكرة الطعن قبل الإيداع", caseId: ids[2], assigneeId: mounir, dueDate: addDaysToDate(today, -1), priority: "HIGH" });
  await tasks.createTask(asMounir, { kind: "REMINDER", title: "الاتصال بالحريف سامي مراد", caseId: ids[1], assigneeId: mounir, dueDate: addDaysToDate(today, 2), dueTime: "10:00" });
  await tasks.createTask(asAdmin, { title: "متابعة الخلاص الشهري لكراء المكتب", assigneeId: adminUserId, dueDate: addDaysToDate(today, 5), recurrence: "MONTHLY", priority: "LOW" });
  return organizationId;
}

async function seedCherif() {
  // A second office: used to demonstrate (and test) that offices never see each other's data.
  const { organizationId, adminUserId } = await ensureOffice({
    name: "مكتب الأستاذة ريم الشريف للمحاماة",
    slug: "cherif-dev",
    admin: { name: "الأستاذة ريم الشريف", email: "r.cherif@cherif.example", password: PASSWORD },
    settings: { city: "صفاقس" },
  });
  if (await hasCases(organizationId)) return console.info("Office cherif-dev already has data: skipped.");
  const ctx = await systemCtx(adminUserId, organizationId);
  // Same reference as in the other office: references are unique per office only.
  const c = await cases.createCase(ctx, {
    reference: "CC/2025/0124",
    type: "LABOR",
    court: "المحكمة الابتدائية بصفاقس",
    assignedLawyerId: adminUserId,
    newClient: { type: "INDIVIDUAL", fullName: "محمد الفراتي" },
  });
  await hearings.createHearing(ctx, { caseId: c.id, date: courtDay(3), time: "09:30", court: "المحكمة الابتدائية بصفاقس", room: "قاعة 1", type: "جلسة صلحية" });
}

async function main() {
  await seedAyari();
  await seedCherif();
  await syncSeedPasswords();
  const receipts = await prisma.receipt.findMany({ select: { number: true, pdfSha256: true, pdfError: true } });
  console.info(`Seed complete: ${await prisma.organization.count()} offices, ${await prisma.case.count()} cases, ${receipts.length} receipts (${receipts.filter((r) => r.pdfSha256).length} PDFs generated${receipts.some((r) => r.pdfError) ? `, ${receipts.filter((r) => r.pdfError).length} PDF failures — check PDF_BROWSER` : ""}).`);
  console.info(`Development accounts (password: ${process.env.SEED_PASSWORD ? "$SEED_PASSWORD" : PASSWORD}):`);
  console.info("  admin  h.majri@ayari.example   | lawyer m.ayari@ayari.example | lawyer s.haddad@ayari.example | clerk a.zouari@ayari.example");
  console.info("  second office admin: r.cherif@cherif.example");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { closePdfBrowser } = await import("../server/services/receipt-pdf.js");
    await closePdfBrowser();
    await prisma.$disconnect();
  });
