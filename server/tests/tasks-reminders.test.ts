import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { addDaysToDate, todayIn } from "../lib/time.js";
import { setMailer, type Mailer } from "../services/mailer.js";
import { deliverDueReminders } from "../services/reminders.js";
import { as, createCaseFor, createTestOffice, login, prisma, type TestOffice } from "./helpers.js";

let office: TestOffice;
let lawyer: ReturnType<typeof as>;
const today = todayIn("Africa/Tunis");
const notConfigured: Mailer = { configured: false, send: async () => ({ ok: false, reason: "not_configured" }) };

beforeAll(async () => {
  office = await createTestOffice();
  lawyer = as(await login(office.lawyer.email));
});

afterEach(() => setMailer(notConfigured));

describe("tasks", () => {
  it("never invents a due time: date-only tasks have no instant and no reminders", async () => {
    const res = await lawyer.post("/tasks", { title: "إيداع تقرير", assigneeId: office.lawyer.id, dueDate: today });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ dueDate: today, dueTime: null, dueAt: null, status: "OPEN", reminders: [] });
  });

  it("schedules one reminder per requested channel at the due instant (office time)", async () => {
    const res = await lawyer.post("/tasks", { title: "اتصال بالحريف", assigneeId: office.clerk.id, dueDate: "2031-03-03", dueTime: "15:00", notifyInApp: true, notifyEmail: true });
    expect(res.body.dueAt).toBe("2031-03-03T14:00:00.000Z");
    expect(res.body.reminders.map((r: { channel: string }) => r.channel).sort()).toEqual(["EMAIL", "IN_APP"]);
    expect(res.body.reminders.every((r: { status: string; scheduledAt: string }) => r.status === "PENDING" && r.scheduledAt === "2031-03-03T14:00:00.000Z")).toBe(true);
  });

  it("buckets tasks by the office's calendar day", async () => {
    const tmp = await createTestOffice();
    const l = as(await login(tmp.lawyer.email));
    await l.post("/tasks", { title: "اليوم", assigneeId: tmp.lawyer.id, dueDate: today });
    await l.post("/tasks", { title: "متأخرة", assigneeId: tmp.lawyer.id, dueDate: addDaysToDate(today, -2) });
    await l.post("/tasks", { title: "قادمة", assigneeId: tmp.lawyer.id, dueDate: addDaysToDate(today, 3) });
    await l.post("/tasks", { title: "بلا تاريخ", assigneeId: tmp.lawyer.id });
    const summary = (await l.get("/tasks/summary")).body;
    expect(summary).toEqual({ today: 1, overdue: 1, upcoming: 2, done: 0 });
    expect((await l.get("/tasks?bucket=overdue")).body.items[0].title).toBe("متأخرة");
  });

  it("warns about a same-hour clash for the same person and saves only when acknowledged", async () => {
    const body = { title: "مهمة", assigneeId: office.lawyer2.id, dueDate: "2031-05-05", dueTime: "10:00" };
    expect((await lawyer.post("/tasks", body)).status).toBe(201);
    const clash = await lawyer.post("/tasks", { ...body, dueTime: "10:30" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("TASK_CONFLICT");
    expect((await lawyer.post("/tasks", { ...body, dueTime: "10:30", acknowledgeConflicts: true })).status).toBe(201);
    expect((await lawyer.post("/tasks", { ...body, dueTime: "12:00" })).status).toBe(201);
  });

  it("completes a recurring task, creating the next occurrence exactly once", async () => {
    const t = (await lawyer.post("/tasks", { title: "متابعة أسبوعية", assigneeId: office.lawyer.id, dueDate: "2031-01-31", dueTime: "09:00", recurrence: "MONTHLY" })).body;
    const done = await lawyer.post(`/tasks/${t.id}/complete`, { version: t.version });
    expect(done.body.task.status).toBe("DONE");
    expect(done.body.next).toMatchObject({ dueDate: "2031-02-28", dueTime: "09:00", status: "OPEN" });
    expect(done.body.task.reminders.every((r: { status: string }) => r.status === "CANCELLED")).toBe(true);
    const reopened = await lawyer.post(`/tasks/${t.id}/reopen`, { version: done.body.task.version });
    expect(reopened.body.status).toBe("OPEN");
    const again = await lawyer.post(`/tasks/${t.id}/complete`, { version: reopened.body.version });
    expect(again.body.next.id).toBe(done.body.next.id);
    expect(await prisma.task.count({ where: { spawnedFromId: t.id } })).toBe(1);
  });

  it("deletes non-destructively: the task leaves the lists and its reminders are cancelled", async () => {
    const t = (await lawyer.post("/tasks", { title: "للحذف", assigneeId: office.lawyer.id, dueDate: "2031-07-01", dueTime: "08:00" })).body;
    const cancelled = await lawyer.post(`/tasks/${t.id}/cancel`, { version: t.version });
    expect(cancelled.body.status).toBe("CANCELLED");
    expect(cancelled.body.reminders.every((r: { status: string }) => r.status === "CANCELLED")).toBe(true);
    expect((await lawyer.get("/tasks?pageSize=200")).body.items.map((x: { id: string }) => x.id)).not.toContain(t.id);
    expect(await prisma.task.findUnique({ where: { id: t.id } })).not.toBeNull();
  });

  it("hides case tasks from users who cannot see the case", async () => {
    const tmp = await createTestOffice();
    const c = await createCaseFor(tmp, { memberIds: [] });
    const l = as(await login(tmp.lawyer.email));
    const t = (await l.post("/tasks", { title: "مهمة ملف", caseId: c.id, assigneeId: tmp.lawyer.id })).body;
    const clerk = as(await login(tmp.clerk.email));
    expect((await clerk.get(`/tasks/${t.id}`)).status).toBe(404);
    expect((await clerk.post("/tasks", { title: "x", caseId: c.id, assigneeId: tmp.clerk.id })).status).toBe(404);
  });
});

describe("reminder delivery", () => {
  async function dueTask(assigneeId: string, channels: { notifyInApp?: boolean; notifyEmail?: boolean }) {
    const t = (await lawyer.post("/tasks", { title: `تذكير ${Math.random()}`, assigneeId, dueDate: "2031-08-01", dueTime: "09:00", acknowledgeConflicts: true, ...channels })).body;
    // Make it due now (the API refuses nothing here: we only move the schedule for the test).
    await prisma.reminder.updateMany({ where: { taskId: t.id }, data: { scheduledAt: new Date(Date.now() - 60_000) } });
    return t;
  }

  it("delivers in-app reminders to the recipient's inbox, and marks them read", async () => {
    const t = await dueTask(office.lawyer.id, { notifyInApp: true, notifyEmail: false });
    const report = await deliverDueReminders();
    expect(report.sent).toBeGreaterThanOrEqual(1);
    const inbox = (await lawyer.get("/reminders/inbox")).body;
    const item = inbox.items.find((r: { taskId: string }) => r.taskId === t.id);
    expect(item).toMatchObject({ channel: "IN_APP", status: "SENT", readAt: null });
    expect((await lawyer.post(`/reminders/${item.id}/read`)).body.readAt).toBeTruthy();
    expect((await lawyer.get("/reminders/inbox")).body.items.map((r: { id: string }) => r.id)).not.toContain(item.id);
    // Another member cannot read or acknowledge it.
    const clerk = as(await login(office.clerk.email));
    expect((await clerk.post(`/reminders/${item.id}/read`)).status).toBe(404);
  });

  it("marks e-mail reminders NOT_CONFIGURED when no mail service exists (never 'sent')", async () => {
    const t = await dueTask(office.lawyer.id, { notifyInApp: false, notifyEmail: true });
    await deliverDueReminders();
    const r = await prisma.reminder.findFirstOrThrow({ where: { taskId: t.id, channel: "EMAIL" } });
    expect(r.status).toBe("NOT_CONFIGURED");
    expect(r.deliveredAt).toBeNull();
    expect(r.lastError).toMatch(/غير مهيأة/);
  });

  it("sends e-mail through the configured service, retrying failures before giving up", async () => {
    const sent: string[] = [];
    setMailer({ configured: true, send: async (m) => (sent.push(m.to), { ok: true }) });
    const ok = await dueTask(office.lawyer.id, { notifyInApp: false, notifyEmail: true });
    await deliverDueReminders();
    expect((await prisma.reminder.findFirstOrThrow({ where: { taskId: ok.id } })).status).toBe("SENT");
    expect(sent).toContain(office.lawyer.email);

    setMailer({ configured: true, send: async () => ({ ok: false, reason: "failed", error: "SMTP 451" }) });
    const bad = await dueTask(office.lawyer.id, { notifyInApp: false, notifyEmail: true });
    for (let i = 0; i < 3; i++) {
      await prisma.reminder.updateMany({ where: { taskId: bad.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await deliverDueReminders();
    }
    const r = await prisma.reminder.findFirstOrThrow({ where: { taskId: bad.id } });
    expect(r).toMatchObject({ status: "FAILED", attempts: 3 });
    expect(r.lastError).toMatch(/SMTP 451/);
  });

  it("does not deliver reminders for tasks already completed", async () => {
    const t = await dueTask(office.lawyer.id, { notifyInApp: true });
    await prisma.task.update({ where: { id: t.id }, data: { status: "DONE", completedAt: new Date() } });
    await deliverDueReminders();
    expect((await prisma.reminder.findFirstOrThrow({ where: { taskId: t.id } })).status).toBe("CANCELLED");
  });

  it("claims each due reminder once even when two workers run at the same time", async () => {
    const t = await dueTask(office.lawyer2.id, { notifyInApp: true });
    const [r1, r2] = await Promise.all([deliverDueReminders(), deliverDueReminders()]);
    const row = await prisma.reminder.findFirstOrThrow({ where: { taskId: t.id } });
    expect(row.attempts).toBe(1);
    expect(r1.processed + r2.processed).toBeGreaterThanOrEqual(1);
  });
});
