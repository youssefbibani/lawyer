import { beforeAll, describe, expect, it } from "vitest";

import { utcToZoned, zonedToUtc } from "../lib/time.js";
import { normalizeSearch } from "../lib/text.js";
import { as, createCaseFor, createTestOffice, login, prisma, type TestOffice } from "./helpers.js";

let office: TestOffice;
let lawyer: ReturnType<typeof as>;

beforeAll(async () => {
  office = await createTestOffice();
  lawyer = as(await login(office.lawyer.email));
});

describe("time zone handling", () => {
  it("converts Africa/Tunis wall-clock time to UTC and back", () => {
    expect(zonedToUtc("2026-03-15", "09:00", "Africa/Tunis")?.toISOString()).toBe("2026-03-15T08:00:00.000Z");
    expect(zonedToUtc("2026-07-15", "09:00", "Africa/Tunis")?.toISOString()).toBe("2026-07-15T08:00:00.000Z");
    expect(utcToZoned(new Date("2026-12-31T23:30:00Z"), "Africa/Tunis")).toEqual({ date: "2027-01-01", time: "00:30" });
    // A daylight-saving gap elsewhere is reported, never silently shifted.
    expect(zonedToUtc("2026-03-29", "02:30", "Europe/Paris")).toBeNull();
    expect(zonedToUtc("2026-02-30", "09:00", "Africa/Tunis")).toBeNull();
  });

  it("normalises Arabic spelling variants for search", () => {
    expect(normalizeSearch("أحمد الإدريسي")).toBe(normalizeSearch("احمد الادريسي"));
    expect(normalizeSearch("فاطمة")).toBe(normalizeSearch("فاطمه"));
    expect(normalizeSearch("مُحَمَّد ٢٠٢٥")).toBe("محمد 2025");
  });
});

describe("clients", () => {
  it("creates, searches (accent-insensitive), updates with optimistic locking and archives", async () => {
    const created = await lawyer.post("/clients", { type: "INDIVIDUAL", fullName: "أحمد الإدريسي", phone: "+216 98 000 111", email: "Ahmed@Example.TN" });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe("ahmed@example.tn");
    const found = await lawyer.get(`/clients?q=${encodeURIComponent("احمد الادريسي")}`);
    expect(found.body.items.map((c: { id: string }) => c.id)).toContain(created.body.id);

    const updated = await lawyer.patch(`/clients/${created.body.id}`, { phone: "+216 98 000 222", version: 1 });
    expect(updated.body).toMatchObject({ phone: "+216 98 000 222", version: 2 });
    const stale = await lawyer.patch(`/clients/${created.body.id}`, { phone: "+216 98 000 333", version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");

    expect((await lawyer.post(`/clients/${created.body.id}/archive`, { version: 2 })).status).toBe(200);
    expect((await lawyer.get("/clients")).body.items.map((c: { id: string }) => c.id)).not.toContain(created.body.id);
    expect((await lawyer.get("/clients?archived=true")).body.items.map((c: { id: string }) => c.id)).toContain(created.body.id);
  });

  it("returns Arabic validation messages with field paths", async () => {
    const res = await lawyer.post("/clients", { type: "ALIEN", fullName: "", email: "not-an-email" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["type", "fullName", "email"]));
    expect(res.body.error.message).toMatch(/[؀-ۿ]/);
  });
});

describe("cases", () => {
  it("opens a file with a new client, then paginates, sorts and searches", async () => {
    const tag = Date.now().toString(36);
    for (let i = 0; i < 3; i++) await createCaseFor(office, { reference: `PG/${tag}/${i}` });
    const page1 = await lawyer.get(`/cases?q=${encodeURIComponent(`PG/${tag}`)}&pageSize=2&sort=reference:asc`);
    expect(page1.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(page1.body.items.map((c: { reference: string }) => c.reference)).toEqual([`PG/${tag}/0`, `PG/${tag}/1`]);
    const page2 = await lawyer.get(`/cases?q=${encodeURIComponent(`PG/${tag}`)}&pageSize=2&page=2&sort=reference:asc`);
    expect(page2.body.items).toHaveLength(1);
    expect((await lawyer.get("/cases?sort=secret:asc")).status).toBe(422);
  });

  it("finds a file by its client's name", async () => {
    const c = await createCaseFor(office, { newClient: { type: "HEIRS", fullName: "ورثة الحاج علي بن عمر" } });
    const res = await lawyer.get(`/cases?q=${encodeURIComponent("الحاج علي")}`);
    expect(res.body.items.map((x: { id: string }) => x.id)).toContain(c.id);
  });

  it("changes status with history, records notes and builds the timeline from the audit log", async () => {
    const c = await createCaseFor(office);
    const closed = await lawyer.post(`/cases/${c.id}/status`, { status: "CLOSED", version: c.version });
    expect(closed.body).toMatchObject({ status: "CLOSED" });
    expect(closed.body.closedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await lawyer.post(`/cases/${c.id}/notes`, { content: "ملاحظة سرية" })).status).toBe(201);
    const timeline = (await lawyer.get(`/cases/${c.id}/timeline`)).body;
    expect(timeline.map((e: { operation: string }) => e.operation)).toEqual(expect.arrayContaining(["case.create", "case.status", "note.create"]));
    // The note text is confidential: it is not copied into the audit trail.
    expect(JSON.stringify(timeline)).not.toContain("ملاحظة سرية");
    const hearing = await lawyer.post("/hearings", { caseId: c.id, date: "2031-01-06", time: "09:00", court: "x", type: "x" });
    expect(hearing.status).toBe(422);
  });

  it("reassigns the lawyer only to an active lawyer of the office", async () => {
    const c = await createCaseFor(office);
    expect((await lawyer.post(`/cases/${c.id}/assign`, { assignedLawyerId: office.clerk.id, version: c.version })).status).toBe(422);
    const ok = await lawyer.post(`/cases/${c.id}/assign`, { assignedLawyerId: office.lawyer2.id, version: c.version });
    expect(ok.body.assignedLawyer.userId).toBe(office.lawyer2.id);
  });
});

describe("hearings", () => {
  it("requires an explicit time and stores the instant in UTC", async () => {
    const c = await createCaseFor(office);
    const noTime = await lawyer.post("/hearings", { caseId: c.id, date: "2031-02-03", court: "محكمة", type: "جلسة" });
    expect(noTime.status).toBe(422);
    expect(noTime.body.error.details.map((d: { path: string }) => d.path)).toContain("time");
    const h = await lawyer.post("/hearings", { caseId: c.id, date: "2031-02-03", time: "09:30", court: "محكمة", room: "قاعة 2", type: "جلسة" });
    expect(h.status).toBe(201);
    expect(h.body).toMatchObject({ date: "2031-02-03", time: "09:30", timeZone: "Africa/Tunis", startsAt: "2031-02-03T08:30:00.000Z" });
  });

  it("warns about overlapping hearings of the same lawyer, and saves only when acknowledged", async () => {
    const c1 = await createCaseFor(office);
    const c2 = await createCaseFor(office);
    const base = { date: "2031-04-07", court: "محكمة", type: "جلسة", durationMinutes: 60 };
    expect((await lawyer.post("/hearings", { ...base, caseId: c1.id, time: "10:00" })).status).toBe(201);
    const preview = await lawyer.get(`/hearings/conflicts?caseId=${c2.id}&date=2031-04-07&time=10:30`);
    expect(preview.body.hearings).toHaveLength(1);
    const clash = await lawyer.post("/hearings", { ...base, caseId: c2.id, time: "10:30" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("HEARING_CONFLICT");
    expect(clash.body.error.data.hearings[0].caseId).toBe(c1.id);
    expect((await lawyer.post("/hearings", { ...base, caseId: c2.id, time: "11:00" })).status).toBe(201);
    expect((await lawyer.post("/hearings", { ...base, caseId: c2.id, time: "10:30", acknowledgeConflicts: true })).status).toBe(201);
    const groups = await lawyer.get("/hearings/conflict-groups");
    expect(groups.body.some((g: { caseId: string }[]) => g.some((h) => h.caseId === c2.id))).toBe(true);
  });

  it("withholds details of conflicting hearings in files the user cannot see", async () => {
    const tmp = await createTestOffice({ lawyersSeeAllCases: false, clerksSeeAllCases: false });
    const secret = await createCaseFor(tmp, { memberIds: [] });
    const visible = await createCaseFor(tmp);
    const lawyerT = as(await login(tmp.lawyer.email));
    await lawyerT.post("/hearings", { caseId: secret.id, date: "2031-06-02", time: "09:00", court: "c", type: "t" });
    const clerk = as(await login(tmp.clerk.email));
    const preview = await clerk.get(`/hearings/conflicts?caseId=${visible.id}&date=2031-06-02&time=09:15`);
    expect(preview.body).toEqual({ hearings: [], hiddenCount: 1 });
    expect(JSON.stringify(preview.body)).not.toContain(secret.reference);
  });

  it("keeps a history of rescheduling and cancels reminders tied to the old time", async () => {
    const c = await createCaseFor(office);
    const h = (await lawyer.post("/hearings", { caseId: c.id, date: "2031-09-01", time: "09:00", court: "محكمة", type: "جلسة" })).body;
    const reminder = await lawyer.post("/reminders", { hearingId: h.id, minutesBefore: 60 });
    expect(reminder.status).toBe(201);
    const moved = await lawyer.patch(`/hearings/${h.id}`, { date: "2031-09-08", time: "11:00", reason: "طلب الدفاع", version: h.version });
    expect(moved.body).toMatchObject({ date: "2031-09-08", time: "11:00", version: h.version + 1 });
    const stale = await lawyer.patch(`/hearings/${h.id}`, { room: "قاعة 9", version: h.version });
    expect(stale.status).toBe(409);
    const history = (await lawyer.get(`/hearings/${h.id}/history`)).body;
    expect(history.map((e: { kind: string }) => e.kind)).toEqual(["CREATED", "RESCHEDULED"]);
    expect(history[1]).toMatchObject({ reason: "طلب الدفاع", before: { date: "2031-09-01", time: "09:00" }, after: { date: "2031-09-08", time: "11:00" } });
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.body.id } })).status).toBe("CANCELLED");
  });

  it("postpones to a new date (creating the follow-up hearing) and requires a reason to cancel", async () => {
    const c = await createCaseFor(office);
    const h = (await lawyer.post("/hearings", { caseId: c.id, date: "2031-10-06", time: "09:00", court: "محكمة", type: "جلسة مرافعة" })).body;
    expect((await lawyer.post(`/hearings/${h.id}/status`, { status: "CANCELLED", version: h.version })).status).toBe(422);
    const postponed = await lawyer.post(`/hearings/${h.id}/status`, { status: "POSTPONED", reason: "تأجيل من المحكمة", next: { date: "2031-11-03", time: "10:00" }, version: h.version });
    expect(postponed.status).toBe(200);
    expect(postponed.body.hearing.status).toBe("POSTPONED");
    expect(postponed.body.next).toMatchObject({ date: "2031-11-03", time: "10:00", status: "SCHEDULED", type: "جلسة مرافعة" });
    expect((await lawyer.patch(`/hearings/${h.id}`, { room: "x", version: postponed.body.hearing.version })).status).toBe(409);
  });

  it("lists hearings for a date range in office time", async () => {
    const c = await createCaseFor(office);
    await lawyer.post("/hearings", { caseId: c.id, date: "2032-01-05", time: "00:30", court: "c", type: "t" });
    const day = await lawyer.get(`/hearings?caseId=${c.id}&from=2032-01-05&to=2032-01-05`);
    expect(day.body.items).toHaveLength(1);
    const before = await lawyer.get(`/hearings?caseId=${c.id}&from=2032-01-04&to=2032-01-04`);
    expect(before.body.items).toHaveLength(0);
  });
});
