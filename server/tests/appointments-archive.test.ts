import { beforeAll, describe, expect, it } from "vitest";

import { addDaysToDate, todayIn } from "../lib/time.js";
import { as, createCaseFor, createTestOffice, login, type TestOffice } from "./helpers.js";

let office: TestOffice;
let lawyer: ReturnType<typeof as>;
const today = todayIn("Africa/Tunis");

beforeAll(async () => {
  office = await createTestOffice();
  lawyer = as(await login(office.lawyer.email));
});

describe("client appointments («مواعيد الحرفاء»)", () => {
  it("books, lists, completes and counts appointments on the dashboard", async () => {
    const client = (await lawyer.post("/clients", { type: "INDIVIDUAL", fullName: "حريف المواعيد" })).body;
    const before = (await lawyer.get("/dashboard")).body.upcomingAppointments;

    const created = await lawyer.post("/appointments", { clientId: client.id, date: addDaysToDate(today, 2), time: "10:30", subject: "إمضاء التوكيل" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ client: { id: client.id, fullName: "حريف المواعيد" }, time: "10:30", subject: "إمضاء التوكيل", status: "SCHEDULED", version: 1 });
    expect((await lawyer.get("/dashboard")).body.upcomingAppointments).toBe(before + 1);

    const upcoming = (await lawyer.get("/appointments")).body.items.map((a: { id: string }) => a.id);
    expect(upcoming).toContain(created.body.id);

    const done = await lawyer.patch(`/appointments/${created.body.id}`, { status: "DONE", version: 1 });
    expect(done.body).toMatchObject({ status: "DONE", version: 2 });
    expect((await lawyer.patch(`/appointments/${created.body.id}`, { subject: "قديم", version: 1 })).status).toBe(409);
    expect((await lawyer.get("/appointments")).body.items.map((a: { id: string }) => a.id)).not.toContain(created.body.id);
    expect((await lawyer.get("/appointments?when=past")).body.items.map((a: { id: string }) => a.id)).toContain(created.body.id);
    expect((await lawyer.get("/dashboard")).body.upcomingAppointments).toBe(before);
  });

  it("validates input in Arabic and keeps appointments inside the office", async () => {
    const client = (await lawyer.post("/clients", { type: "INDIVIDUAL", fullName: "حريف آخر" })).body;
    const missing = await lawyer.post("/appointments", { clientId: client.id, date: today, subject: " " });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.map((d: { path: string }) => d.path)).toContain("subject");

    const mine = (await lawyer.post("/appointments", { clientId: client.id, date: today, subject: "استشارة" })).body;
    const other = await createTestOffice();
    const stranger = as(await login(other.lawyer.email));
    expect((await stranger.post("/appointments", { clientId: client.id, date: today, subject: "x" })).status).toBe(404);
    expect((await stranger.patch(`/appointments/${mine.id}`, { status: "CANCELLED", version: 1 })).status).toBe(404);
    expect((await stranger.get("/appointments")).body.items).toEqual([]);
  });
});

describe("case archive", () => {
  it("moves a closed case to the archive one month after its closing date", async () => {
    const openedOn = addDaysToDate(today, -90);
    const old = await createCaseFor(office, { openedOn });
    const recent = await createCaseFor(office, { openedOn });
    const active = await createCaseFor(office, { openedOn });
    expect((await lawyer.post(`/cases/${old.id}/status`, { status: "CLOSED", closedOn: addDaysToDate(today, -40), version: old.version })).status).toBe(200);
    expect((await lawyer.post(`/cases/${recent.id}/status`, { status: "CLOSED", closedOn: addDaysToDate(today, -5), version: recent.version })).status).toBe(200);

    const ids = async (query: string) => ((await lawyer.get(`/cases?pageSize=100${query}`)).body.items as { id: string }[]).map((c) => c.id);
    const main = await ids("");
    expect(main).toEqual(expect.arrayContaining([recent.id, active.id]));
    expect(main).not.toContain(old.id);
    expect(await ids("&status=CLOSED")).toContain(recent.id);
    expect(await ids("&status=CLOSED")).not.toContain(old.id);
    const archive = await ids("&archived=true");
    expect(archive).toContain(old.id);
    expect(archive).not.toContain(recent.id);
    expect(archive).not.toContain(active.id);
    // An archived case still opens.
    expect((await lawyer.get(`/cases/${old.id}`)).status).toBe(200);
  });
});

describe("clients by year", () => {
  it("filters clients by registration year", async () => {
    const c = (await lawyer.post("/clients", { type: "COMPANY", fullName: "شركة السنة" })).body;
    const year = c.createdAt.slice(0, 4);
    expect(((await lawyer.get(`/clients?year=${year}&pageSize=100`)).body.items as { id: string }[]).map((x) => x.id)).toContain(c.id);
    expect(((await lawyer.get("/clients?year=2001&pageSize=100")).body.items as { id: string }[]).map((x) => x.id)).not.toContain(c.id);
  });
});
