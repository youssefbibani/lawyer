import { beforeAll, describe, expect, it } from "vitest";

import { setMailer, type MailMessage, type Mailer } from "../services/mailer.js";
import { LOGIN_FAILURE_LIMIT } from "../routes/auth.js";
import { as, call, cookieFrom, createTestOffice, freshIp, login, PASSWORD, prisma, signIn, totp, type TestOffice } from "./helpers.js";

let office: TestOffice;

beforeAll(async () => {
  office = await createTestOffice();
});

describe("sign-in and sessions", () => {
  it("signs in, exposes the server-resolved identity, and never returns the session token to the page", async () => {
    const { res, cookie } = await signIn(office.lawyer.email);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(cookie).toMatch(/qasr\.session_token=/);
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const me = await as(cookie).get("/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(office.lawyer.email);
    expect(me.body.role).toBe("lawyer");
    expect(me.body.office.id).toBe(office.organizationId);
    expect(me.body.office.timeZone).toBe("Africa/Tunis");
  });

  it("rejects a wrong password and an unknown account with the same answer", async () => {
    const wrong = await signIn(office.lawyer.email, "not-the-password!!");
    const unknown = await signIn("nobody@test.example", "not-the-password!!");
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(wrong.res.body.code).toBe(unknown.res.body.code);
    expect(wrong.cookie).not.toMatch(/session_token/);
  });

  it("requires a session for every API route", async () => {
    const res = await call("GET", "/api/v1/cases");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(res.body.error.message).toMatch(/تسجيل الدخول/);
    expect(res.body.error.requestId).toBeTruthy();
  });

  it("signs out and the old cookie stops working", async () => {
    const cookie = await login(office.lawyer.email);
    expect((await as(cookie).get("/me")).status).toBe(200);
    const out = await call("POST", "/api/auth/sign-out", { cookie, body: {} });
    expect(out.status).toBe(200);
    expect((await as(cookie).get("/me")).status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const cookie = await login(office.lawyer2.email);
    const token = decodeURIComponent(cookie.match(/qasr\.session_token=([^;]+)/)![1]).split(".")[0];
    await prisma.session.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await as(cookie).get("/me")).status).toBe(401);
  });

  it("lists the user's sessions without tokens and revokes another device by id", async () => {
    const first = await login(office.lawyer2.email);
    const second = await login(office.lawyer2.email);
    const list = await as(first).get("/me/sessions");
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(/token/i);
    const other = list.body.find((s: { current: boolean }) => !s.current);
    expect((await as(first).del(`/me/sessions/${other.id}`)).status).toBe(200);
    expect((await as(second).get("/me")).status).toBe(401);
    expect((await as(first).get("/me")).status).toBe(200);
  });

  it("blocks deactivated members from signing in and ends their sessions", async () => {
    const tmp = await createTestOffice();
    const clerkCookie = await login(tmp.clerk.email);
    const admin = as(await login(tmp.admin.email));
    expect((await admin.post(`/settings/members/${tmp.clerk.id}/deactivate`)).status).toBe(200);
    expect((await as(clerkCookie).get("/me")).status).toBe(401);
    const again = await signIn(tmp.clerk.email);
    expect(again.res.status).toBe(403);
    expect(again.res.body.code).toBe("ACCOUNT_DISABLED");
  });
});

describe("abuse protection", () => {
  it("rate-limits sign-in attempts per client address", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await signIn(office.clerk.email, "wrong-password-xx", ip)).res.status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("locks an account after repeated failures from many addresses, without blocking other accounts", async () => {
    const tmp = await createTestOffice();
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) expect((await signIn(tmp.lawyer.email, "wrong-password-xx")).res.status).toBe(401);
    const locked = await signIn(tmp.lawyer.email, PASSWORD);
    expect(locked.res.status).toBe(429);
    expect(locked.res.body.error.code).toBe("RATE_LIMITED");
    expect((await signIn(tmp.lawyer2.email)).res.status).toBe(200);
    const failures = await prisma.auditLog.count({ where: { operation: "auth.sign_in", outcome: "FAILURE" } });
    expect(failures).toBeGreaterThanOrEqual(LOGIN_FAILURE_LIMIT);
  });

  it("rejects mutations without a trusted Origin (CSRF)", async () => {
    const cookie = await login(office.lawyer.email);
    const none = await call("POST", "/api/v1/clients", { cookie, origin: null, body: { type: "INDIVIDUAL", fullName: "س" } });
    const evil = await call("POST", "/api/v1/clients", { cookie, origin: "https://evil.example", body: { type: "INDIVIDUAL", fullName: "س" } });
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe("CSRF_REJECTED");
    expect(evil.status).toBe(403);
  });

  it("applies the same Origin check to authentication endpoints", async () => {
    const cookie = await login(office.lawyer2.email);
    const signOut = await call("POST", "/api/auth/sign-out", { cookie, body: {}, origin: "https://evil.example" });
    const change = await call("POST", "/api/auth/change-password", { cookie, body: { currentPassword: PASSWORD, newPassword: "Evil-Passw0rd-999" }, origin: "https://evil.example" });
    const forcedLogin = await call("POST", "/api/auth/sign-in/email", { body: { email: office.lawyer2.email, password: PASSWORD }, origin: null, ip: freshIp() });
    expect([signOut.status, change.status, forcedLogin.status]).toEqual([403, 403, 403]);
    expect((await as(cookie).get("/me")).status).toBe(200);
    expect((await signIn(office.lawyer2.email, PASSWORD)).res.status).toBe(200);
  });

  it("does not expose public sign-up or organization-plugin administration", async () => {
    const signUp = await call("POST", "/api/auth/sign-up/email", { body: { email: "x@test.example", password: PASSWORD, name: "x" } });
    expect(signUp.status).toBe(404);
    const cookie = await login(office.admin.email);
    const create = await call("POST", "/api/auth/organization/create", { cookie, body: { name: "x", slug: "x-org" } });
    const role = await call("POST", "/api/auth/organization/update-member-role", { cookie, body: { memberId: "x", role: "admin" } });
    expect(create.status).toBe(404);
    expect(role.status).toBe(404);
  });
});

describe("password management", () => {
  it("changes the password (current password required) and revokes other sessions", async () => {
    const tmp = await createTestOffice();
    const cookie = await login(tmp.lawyer.email);
    const other = await login(tmp.lawyer.email);
    const bad = await call("POST", "/api/auth/change-password", { cookie, body: { currentPassword: "wrong-wrong-1", newPassword: "New-Passw0rd-456" } });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const ok = await call("POST", "/api/auth/change-password", { cookie, body: { currentPassword: PASSWORD, newPassword: "New-Passw0rd-456", revokeOtherSessions: true } });
    expect(ok.status).toBe(200);
    expect((await as(other).get("/me")).status).toBe(401);
    expect((await signIn(tmp.lawyer.email, PASSWORD)).res.status).toBe(401);
    expect((await signIn(tmp.lawyer.email, "New-Passw0rd-456")).res.status).toBe(200);
  });

  it("rejects passwords shorter than the policy minimum", async () => {
    const tmp = await createTestOffice();
    const cookie = await login(tmp.lawyer.email);
    const res = await call("POST", "/api/auth/change-password", { cookie, body: { currentPassword: PASSWORD, newPassword: "short1" } });
    expect(res.status).toBe(400);
  });

  it("says honestly that reset e-mails are unavailable without SMTP, identically for every address", async () => {
    setMailer({ configured: false, send: async () => ({ ok: false, reason: "not_configured" }) });
    const known = await call("POST", "/api/auth/request-password-reset", { body: { email: office.clerk.email, redirectTo: "/reset-password" } });
    const unknown = await call("POST", "/api/auth/request-password-reset", { body: { email: "ghost@test.example", redirectTo: "/reset-password" } });
    expect(known.status).toBe(503);
    expect(unknown.status).toBe(503);
    expect(known.body.error.message).toBe(unknown.body.error.message);
    expect(known.body.error.message).toMatch(/خدمة البريد غير مهيأة/);
  });

  it("resets a forgotten password through the e-mailed link only", async () => {
    const tmp = await createTestOffice();
    const sent: MailMessage[] = [];
    const recorder: Mailer = { configured: true, send: async (m) => (sent.push(m), { ok: true }) };
    setMailer(recorder);
    const req = await call("POST", "/api/auth/request-password-reset", { body: { email: tmp.clerk.email, redirectTo: "/reset-password" } });
    expect(req.status).toBe(200);
    expect(sent).toHaveLength(1);
    const token = sent[0].text.match(/reset-password\/([A-Za-z0-9_-]+)/)![1];
    const reset = await call("POST", "/api/auth/reset-password", { body: { token, newPassword: "Reset-Passw0rd-789" } });
    expect(reset.status).toBe(200);
    expect((await signIn(tmp.clerk.email, "Reset-Passw0rd-789")).res.status).toBe(200);
    const reuse = await call("POST", "/api/auth/reset-password", { body: { token, newPassword: "Again-Passw0rd-000" } });
    expect(reuse.status).toBe(400);
    // An unknown address gets the same answer and no e-mail.
    expect((await call("POST", "/api/auth/request-password-reset", { body: { email: "ghost@test.example", redirectTo: "/reset-password" } })).status).toBe(200);
    expect(sent).toHaveLength(1);
    setMailer({ configured: false, send: async () => ({ ok: false, reason: "not_configured" }) });
  });
});

describe("two-factor authentication (TOTP)", () => {
  it("enables TOTP, then requires the code at sign-in", async () => {
    const tmp = await createTestOffice();
    const cookie = await login(tmp.lawyer.email);
    const enable = await call("POST", "/api/auth/two-factor/enable", { cookie, body: { password: PASSWORD } });
    expect(enable.status).toBe(200);
    const secret = new URL(enable.body.totpURI).searchParams.get("secret")!;
    expect(enable.body.backupCodes.length).toBeGreaterThan(0);
    const verify = await call("POST", "/api/auth/two-factor/verify-totp", { cookie, body: { code: totp(secret) } });
    expect(verify.status).toBe(200);
    expect((await as(cookieFrom(verify.headers, cookie)).get("/me")).body.user.twoFactorEnabled).toBe(true);

    const first = await signIn(tmp.lawyer.email);
    expect(first.res.status).toBe(200);
    expect(first.res.body.twoFactorRedirect).toBe(true);
    expect((await as(first.cookie).get("/me")).status).toBe(401);

    const wrong = await call("POST", "/api/auth/two-factor/verify-totp", { cookie: first.cookie, body: { code: "000000" } });
    expect(wrong.status).toBe(401);
    const ok = await call("POST", "/api/auth/two-factor/verify-totp", { cookie: first.cookie, body: { code: totp(secret, Date.now() + 30_000) } });
    expect(ok.status).toBe(200);
    const session = cookieFrom(ok.headers, first.cookie);
    expect((await as(session).get("/me")).status).toBe(200);
  });
});
