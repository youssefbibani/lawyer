import { afterEach, describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Login from "@/pages/Login";
import { meFixture, mockApi, renderAt } from "./api-mock";

afterEach(() => vi.unstubAllGlobals());

const unauthenticated = { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "يرجى تسجيل الدخول." } } };

function renderLogin(signIn: () => unknown) {
  let signedIn = false;
  const api = mockApi({
    "GET /api/v1/me": () => (signedIn ? meFixture() : unauthenticated),
    "POST /api/auth/sign-in/email": () => {
      const result = signIn() as { status?: number; body?: { twoFactorRedirect?: boolean } };
      if ((result.status ?? 200) === 200 && !result.body?.twoFactorRedirect) signedIn = true;
      return result;
    },
    "POST /api/auth/two-factor/verify-totp": () => {
      signedIn = true;
      return { status: 200, body: { user: { id: "u-lawyer" } } };
    },
  });
  renderAt("/", [
    { path: "/", element: <Login /> },
    { path: "/app", element: <div>لوحة التحكم الرئيسية</div> },
  ]);
  return api;
}

describe("Login page", () => {
  it("renders Arabic login content", () => {
    renderLogin(() => ({ status: 200, body: {} }));
    expect(screen.getByRole("heading", { name: "قصر العدالة" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();
    expect(screen.getByLabelText("البريد الإلكتروني")).toBeInTheDocument();
    expect(screen.getByLabelText("كلمة المرور")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تسجيل الدخول" })).toBeInTheDocument();
  });

  it("shows validation errors before contacting the server", async () => {
    const { calls } = renderLogin(() => ({ status: 200, body: {} }));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("البريد الإلكتروني"), "invalid-email");
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول" }));
    expect(await screen.findByText("البريد الإلكتروني غير صالح")).toBeInTheDocument();
    expect(screen.getByText("يرجى إدخال كلمة المرور")).toBeInTheDocument();
    expect(calls.some((c) => c.path.includes("sign-in"))).toBe(false);
  });

  it("shows the server's refusal in Arabic for wrong credentials", async () => {
    renderLogin(() => ({ status: 401, body: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" } }));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("البريد الإلكتروني"), "m.ayari@ayari.example");
    await user.type(screen.getByLabelText("كلمة المرور"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول" }));
    expect(await screen.findByText("البريد الإلكتروني أو كلمة المرور غير صحيحة.")).toBeInTheDocument();
    expect(screen.queryByText("لوحة التحكم الرئيسية")).not.toBeInTheDocument();
  });

  it("signs in with the server and opens the dashboard, storing nothing in the browser", async () => {
    const { calls } = renderLogin(() => ({ status: 200, body: { user: { id: "u-lawyer" } } }));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("البريد الإلكتروني"), "m.ayari@ayari.example");
    await user.type(screen.getByLabelText("كلمة المرور"), "Correct-Passw0rd");
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول" }));
    expect(await screen.findByText("لوحة التحكم الرئيسية")).toBeInTheDocument();
    const signIn = calls.find((c) => c.path === "/api/auth/sign-in/email");
    expect(signIn?.body).toMatchObject({ email: "m.ayari@ayari.example", password: "Correct-Passw0rd" });
    expect(Object.keys(window.localStorage).filter((k) => /session|token/i.test(k))).toEqual([]);
  });

  it("asks for the authenticator code when two-factor authentication is enabled", async () => {
    renderLogin(() => ({ status: 200, body: { twoFactorRedirect: true } }));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("البريد الإلكتروني"), "m.ayari@ayari.example");
    await user.type(screen.getByLabelText("كلمة المرور"), "Correct-Passw0rd");
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول" }));
    expect(await screen.findByText("التحقق بخطوتين")).toBeInTheDocument();
    await user.type(screen.getByLabelText("رمز التحقق"), "123456");
    await user.click(screen.getByRole("button", { name: "تأكيد" }));
    await waitFor(() => expect(screen.getByText("لوحة التحكم الرئيسية")).toBeInTheDocument());
  });
});
