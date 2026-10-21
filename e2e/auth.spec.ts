import { expect, test } from "@playwright/test";

import { accounts } from "./accounts";

test.describe("authentication (real server)", () => {
  test("protected pages redirect to the Arabic RTL sign-in page", async ({ page }) => {
    await page.goto("/app/cases");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  });

  test("rejects a wrong password with an Arabic message", async ({ page }) => {
    const a = accounts();
    await page.goto("/");
    await page.getByLabel("البريد الإلكتروني").fill(a.lawyer);
    await page.getByLabel("كلمة المرور", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await expect(page.getByRole("alert")).toHaveText("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
    await expect(page).toHaveURL(/\/$/);
  });

  test("signs in, shows the server identity, and signs out", async ({ page }) => {
    const a = accounts();
    await page.goto("/");
    await page.getByLabel("البريد الإلكتروني").fill(a.lawyer);
    await page.getByLabel("كلمة المرور", { exact: true }).fill(a.password);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await expect(page.getByRole("heading", { name: "لوحة التحكم" })).toBeVisible();
    await expect(page.getByText("الأستاذ سامي التجربة").first()).toBeVisible();
    // The session lives in an httpOnly cookie: nothing readable by scripts.
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/session_token/);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /session|token/i.test(k)))).toEqual([]);

    await page.getByRole("button", { name: "تسجيل الخروج" }).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: "تسجيل الخروج" }).click();
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  });
});
