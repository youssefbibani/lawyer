import { expect, test } from "@playwright/test";

import { accounts, stateFor } from "./accounts";

test.describe("lawyer workflows (real server and database)", () => {
  test.use({ storageState: stateFor("lawyer") });

  test("opens a new case with a new client", async ({ page }) => {
    const a = accounts();
    await page.goto("/app/cases");
    await page.getByRole("button", { name: "قضية جديدة" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("اسم الحريف").fill("ورثة التجربة الآلية");
    await dialog.getByLabel("مرجع القضية").fill(`E2E/${a.tag}/2`);
    await dialog.getByRole("combobox", { name: "نوع القضية" }).click();
    await page.getByRole("option", { name: "نزاع ميراث" }).click();
    await dialog.getByLabel("المحكمة").fill("محكمة الاستئناف بتونس");
    await dialog.getByRole("button", { name: "حفظ القضية" }).click();
    await expect(page.getByText(`E2E/${a.tag}/2`).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "ورثة التجربة الآلية" })).toBeVisible();
  });

  test("schedules hearings and warns about a clash for the same lawyer", async ({ page }) => {
    const a = accounts();
    await page.goto(`/app/cases/${a.caseId}`);
    await page.getByRole("tab", { name: "الجلسات" }).click();
    await page.getByRole("button", { name: "تحديد جلسة" }).last().click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("نوع الجلسة").fill("جلسة مرافعة");
    await dialog.getByLabel("التاريخ").fill("2031-05-12");
    await dialog.getByLabel("الوقت").fill("10:00");
    await dialog.getByRole("button", { name: "حفظ الجلسة" }).click();
    await expect(page.getByText("جلسة مرافعة")).toBeVisible();

    // A second hearing of the same lawyer, 30 minutes later, on another file.
    await page.goto("/app/agenda");
    await page.getByRole("button", { name: "إضافة جلسة" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "القضية" }).click();
    await page.getByRole("option").filter({ hasText: `E2E/${a.tag}/2` }).click();
    await dialog.getByLabel("نوع الجلسة").fill("جلسة استماع");
    await dialog.getByLabel("التاريخ").fill("2031-05-12");
    await dialog.getByLabel("الوقت").fill("10:30");
    await expect(dialog.getByText(/تعارض مع جلسة أخرى/)).toBeVisible();
    await dialog.getByRole("button", { name: "حفظ الجلسة" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByText("أؤكد البرمجة رغم التعارض").click();
    await dialog.getByRole("button", { name: "حفظ الجلسة" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("alert").filter({ hasText: "تنبيه: يوجد تعارض" }).first()).toBeVisible();
  });

  test("records a payment and downloads the real Arabic PDF receipt", async ({ page }) => {
    await page.goto("/app/payments");
    const row = page.getByRole("row").filter({ hasText: "حريف التجربة الأول" });
    await row.getByRole("button", { name: "وصل" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/المبلغ المستلم/).fill("450.500");
    await dialog.getByRole("button", { name: "متابعة" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "تسجيل وإصدار الوصل" }).click();
    const number = dialog.getByText(/REC-\d{4}-\d{6}/);
    await expect(number).toBeVisible();
    const link = dialog.getByRole("link", { name: "عرض الوصل (PDF)" });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    const pdf = await page.request.get(href!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    await dialog.getByRole("button", { name: "إغلاق" }).first().click();
    await expect(row.getByText("450.500 د.ت")).toBeVisible();
    await expect(row.getByText("749.500 د.ت")).toBeVisible();
  });

  test("creates a task and completes it", async ({ page }) => {
    await page.goto("/app/tasks");
    await page.getByRole("button", { name: "مهمة جديدة" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("العنوان").fill("إيداع مذكرة الرد");
    await dialog.getByRole("button", { name: "حفظ" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("checkbox", { name: "إنجاز: إيداع مذكرة الرد" }).click({ force: true });
    await expect(page.getByText("تم إنجاز المهمة")).toBeVisible();
    await page.getByRole("tab", { name: /المنجزة/ }).click();
    await expect(page.getByText("إيداع مذكرة الرد")).toBeVisible();
  });
});

test.describe("clerk restrictions (enforced by the server)", () => {
  test.use({ storageState: stateFor("clerk") });

  test("a clerk cannot change case status or see finances", async ({ page }) => {
    const a = accounts();
    await page.goto(`/app/cases/${a.caseId}`);
    await expect(page.getByText(a.caseReference).first()).toBeVisible();
    await expect(page.getByRole("combobox", { name: "حالة القضية" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "الأتعاب" })).toHaveCount(0);
    await page.goto("/app/payments");
    await expect(page.getByText("غير مصرّح")).toBeVisible();
    // Direct API call with the clerk's own session is refused by the server too.
    const res = await page.request.post(`/api/v1/cases/${a.caseId}/status`, { data: { status: "CLOSED", version: 1 }, headers: { Origin: new URL(page.url()).origin } });
    expect(res.status()).toBe(403);
  });
});
