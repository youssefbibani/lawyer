import { beforeAll, describe, expect, it } from "vitest";

import { as, createCaseFor, createTestOffice, ctxFor, idempotencyKey, login, prisma, useFakePdf, type TestOffice } from "./helpers.js";

let a: TestOffice;
let b: TestOffice;
let caseA: Awaited<ReturnType<typeof createCaseFor>>;
let hearingA: string;
let agreementA: string;
let paymentA: string;
let receiptA: string;
let taskA: string;
let clientA: string;

beforeAll(async () => {
  useFakePdf();
  a = await createTestOffice();
  b = await createTestOffice();
  caseA = await createCaseFor(a);
  clientA = caseA.clients[0].id;
  const lawyerA = as(await login(a.lawyer.email));
  hearingA = (await lawyerA.post("/hearings", { caseId: caseA.id, date: "2031-03-03", time: "09:00", court: "محكمة", type: "جلسة" })).body.id;
  agreementA = (await lawyerA.post("/fees", { caseId: caseA.id, amount: "1000" })).body.id;
  const pay = await lawyerA.post("/payments", { agreementId: agreementA, amount: "100", paidOn: "2026-01-02", method: "CASH" }, { "Idempotency-Key": idempotencyKey() });
  paymentA = pay.body.payment.id;
  receiptA = pay.body.payment.receipt.id;
  taskA = (await lawyerA.post("/tasks", { title: "مهمة سرية", caseId: caseA.id, assigneeId: a.lawyer.id })).body.id;
});

describe("cross-office isolation", () => {
  it("never reveals another office's records, even by exact id", async () => {
    const intruder = as(await login(b.admin.email));
    const probes = [
      `/cases/${caseA.id}`,
      `/cases/${caseA.id}/notes`,
      `/cases/${caseA.id}/timeline`,
      `/clients/${clientA}`,
      `/hearings/${hearingA}`,
      `/hearings/${hearingA}/history`,
      `/fees/${agreementA}`,
      `/payments/${paymentA}`,
      `/receipts/${receiptA}`,
      `/receipts/${receiptA}/pdf`,
      `/tasks/${taskA}`,
    ];
    for (const path of probes) {
      const res = await intruder.get(path);
      expect(res.status, path).toBe(404);
    }
    const lists = await Promise.all(["/cases", "/clients", "/hearings", "/fees", "/payments", "/receipts", "/tasks"].map((p) => intruder.get(p)));
    for (const list of lists) expect(JSON.stringify(list.body)).not.toContain(caseA.reference);
  });

  it("refuses to modify another office's records", async () => {
    const intruder = as(await login(b.admin.email));
    expect((await intruder.patch(`/cases/${caseA.id}`, { court: "x", version: 1 })).status).toBe(404);
    expect((await intruder.post(`/cases/${caseA.id}/notes`, { content: "x" })).status).toBe(404);
    expect((await intruder.patch(`/hearings/${hearingA}`, { room: "x", version: 1 })).status).toBe(404);
    expect((await intruder.post(`/payments/${paymentA}/void`, { reason: "x" })).status).toBe(404);
    expect((await intruder.post(`/tasks/${taskA}/complete`, { version: 1 })).status).toBe(404);
    const pay = await intruder.post("/payments", { agreementId: agreementA, amount: "1", paidOn: "2026-01-02", method: "CASH" }, { "Idempotency-Key": idempotencyKey() });
    expect(pay.status).toBe(404);
    const hearing = await intruder.post("/hearings", { caseId: caseA.id, date: "2031-03-04", time: "10:00", court: "x", type: "x" });
    expect(hearing.status).toBe(404);
    const after = await prisma.case.findUniqueOrThrow({ where: { id: caseA.id } });
    expect(after.court).toBe("محكمة التعقيب");
  });

  it("refuses to link another office's people or clients", async () => {
    const adminB = as(await login(b.admin.email));
    const withForeignLawyer = await adminB.post("/cases", { reference: "X/1", type: "CIVIL", court: "c", assignedLawyerId: a.lawyer.id, newClient: { type: "INDIVIDUAL", fullName: "س" } });
    expect(withForeignLawyer.status).toBe(422);
    const withForeignClient = await adminB.post("/cases", { reference: "X/2", type: "CIVIL", court: "c", assignedLawyerId: b.admin.id, clientIds: [clientA] });
    expect(withForeignClient.status).toBe(422);
    const taskForForeigner = await adminB.post("/tasks", { title: "x", assigneeId: a.clerk.id });
    expect(taskForForeigner.status).toBe(422);
  });

  it("ignores a client-supplied office id: identity comes from the session", async () => {
    const adminB = as(await login(b.admin.email));
    const res = await adminB.post("/clients", { type: "INDIVIDUAL", fullName: "حريف مكتب ب", organizationId: a.organizationId });
    expect(res.status).toBe(201);
    const stored = await prisma.client.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.organizationId).toBe(b.organizationId);
  });

  it("enforces office consistency in the database itself (composite foreign keys)", async () => {
    const caseB = await createCaseFor(b);
    await expect(
      prisma.hearing.create({
        data: { organizationId: b.organizationId, caseId: caseA.id, startsAt: new Date(), court: "x", type: "x", createdById: b.admin.id, updatedById: b.admin.id },
      }),
    ).rejects.toThrow();
    await expect(prisma.caseClient.create({ data: { organizationId: b.organizationId, caseId: caseB.id, clientId: clientA } })).rejects.toThrow();
  });

  it("keeps case references unique per office only", async () => {
    const res = await createCaseFor(b, { reference: caseA.reference, assignedLawyerId: b.lawyer.id, memberIds: [] });
    expect(res.reference).toBe(caseA.reference);
    const dup = await as(await login(a.lawyer.email)).post("/cases", { reference: caseA.reference, type: "CIVIL", court: "c", assignedLawyerId: a.lawyer.id, clientIds: [clientA] });
    expect(dup.status).toBe(409);
  });
});

describe("role restrictions", () => {
  it("lets a clerk prepare work but not change status, reassign, cancel hearings, or touch money", async () => {
    const clerk = as(await login(a.clerk.email));
    const c = await clerk.get(`/cases/${caseA.id}`);
    expect(c.status).toBe(200);
    expect(c.body.can).toMatchObject({ changeStatus: false, assign: false, finance: false, addNote: true, scheduleHearing: true });

    expect((await clerk.post(`/cases/${caseA.id}/status`, { status: "CLOSED", version: c.body.version })).status).toBe(403);
    expect((await clerk.post(`/cases/${caseA.id}/assign`, { assignedLawyerId: a.lawyer2.id, version: c.body.version })).status).toBe(403);
    expect((await clerk.put(`/cases/${caseA.id}/members`, { userIds: [], version: c.body.version })).status).toBe(403);
    const h = await clerk.get(`/hearings/${hearingA}`);
    const cancel = await clerk.post(`/hearings/${hearingA}/status`, { status: "CANCELLED", reason: "x", version: h.body.version });
    expect(cancel.status).toBe(403);
    expect(cancel.body.error.message).toMatch(/إلغاء الجلسات/);
    expect((await clerk.get("/fees")).status).toBe(403);
    expect((await clerk.post("/payments", { agreementId: agreementA, amount: "1", paidOn: "2026-01-02", method: "CASH" }, { "Idempotency-Key": idempotencyKey() })).status).toBe(403);
    expect((await clerk.get("/settings/audit")).status).toBe(403);
    expect((await clerk.post("/settings/members", { name: "x", email: "x@test.example", role: "admin", password: "Passw0rd-long" })).status).toBe(403);

    // Allowed: notes and hearings on staffed files.
    expect((await clerk.post(`/cases/${caseA.id}/notes`, { content: "اتصلت بكتابة المحكمة" })).status).toBe(201);
    expect((await clerk.post("/hearings", { caseId: caseA.id, date: "2031-05-05", time: "11:00", court: "محكمة", type: "جلسة" })).status).toBe(201);

    const denied = await prisma.auditLog.count({ where: { organizationId: a.organizationId, actorId: a.clerk.id, outcome: "DENIED" } });
    expect(denied).toBeGreaterThanOrEqual(5);
  });

  it("lets clerks record (not void) payments only when the office allows it", async () => {
    const office = await createTestOffice({ clerksCanRecordPayments: true });
    const c = await createCaseFor(office);
    const lawyer = as(await login(office.lawyer.email));
    const fee = (await lawyer.post("/fees", { caseId: c.id, amount: "500" })).body;
    const clerk = as(await login(office.clerk.email));
    const pay = await clerk.post("/payments", { agreementId: fee.id, amount: "100", paidOn: "2026-01-02", method: "CASH" }, { "Idempotency-Key": idempotencyKey() });
    expect(pay.status).toBe(201);
    expect((await clerk.post(`/payments/${pay.body.payment.id}/void`, { reason: "خطأ" })).status).toBe(403);
  });

  it("limits clerks to the files they are staffed on", async () => {
    const other = await createCaseFor(a, { memberIds: [] });
    const clerk = as(await login(a.clerk.email));
    expect((await clerk.get(`/cases/${other.id}`)).status).toBe(404);
    const list = await clerk.get("/cases?pageSize=100");
    expect(list.body.items.map((c: { id: string }) => c.id)).not.toContain(other.id);
    expect(list.body.items.map((c: { id: string }) => c.id)).toContain(caseA.id);
  });

  it("applies the office policy on lawyers seeing every file", async () => {
    const office = await createTestOffice({ lawyersSeeAllCases: false });
    const mine = await createCaseFor(office);
    const lawyer2 = as(await login(office.lawyer2.email));
    expect((await lawyer2.get(`/cases/${mine.id}`)).status).toBe(404);
    const admin = as(await login(office.admin.email));
    expect((await admin.patch("/settings/office", { lawyersSeeAllCases: true })).status).toBe(200);
    expect((await lawyer2.get(`/cases/${mine.id}`)).status).toBe(200);
  });

  it("protects office settings and member management", async () => {
    const office = await createTestOffice();
    const lawyer = as(await login(office.lawyer.email));
    expect((await lawyer.patch("/settings/office", { legalName: "x" })).status).toBe(403);
    const admin = as(await login(office.admin.email));
    expect((await admin.patch(`/settings/members/${office.admin.id}`, { role: "clerk" })).status).toBe(409);
    expect((await admin.post(`/settings/members/${office.admin.id}/deactivate`)).status).toBe(409);
    const created = await admin.post("/settings/members", { name: "عضو جديد", email: `new.${office.slug}@test.example`, role: "lawyer", password: "Fresh-Passw0rd-1" });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toMatch(/password|hash/i);
    expect((await admin.patch(`/settings/members/${created.body.userId}`, { role: "admin" })).status).toBe(200);
    const audit = await admin.get("/settings/audit?resourceType=member");
    expect(audit.body.items.map((e: { operation: string }) => e.operation)).toEqual(expect.arrayContaining(["member.create", "member.role"]));
  });
});

describe("service layer uses the same rules", () => {
  it("denies a clerk at the service level, independent of the HTTP routes", async () => {
    const { changeCaseStatus } = await import("../services/cases.js");
    await expect(changeCaseStatus(await ctxFor(a, "clerk"), caseA.id, { status: "CLOSED", version: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
