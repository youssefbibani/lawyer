import { expect, test } from "@playwright/test";

import { stateFor } from "./accounts";

test.use({ storageState: stateFor("lawyer") });

async function noHorizontalOverflow(page: import("@playwright/test").Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(width + 1);
}

test.describe("mobile (phone viewport)", () => {
  test("dashboard fits the screen and shows the bottom navigation", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "لوحة التحكم" })).toBeVisible();
    await expect(page.getByText("قضية نشطة")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "التنقل السريع" })).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test("cases render as cards and payments as stacked rows without overflow", async ({ page }) => {
    await page.goto("/app/cases");
    await expect(page.getByRole("list", { name: "قائمة القضايا" })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.goto("/app/payments");
    await expect(page.getByText("سجل الأتعاب")).toBeVisible();
    await noHorizontalOverflow(page);
    await page.goto("/app/clients");
    await expect(page.getByRole("heading", { name: "الحرفاء" })).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
