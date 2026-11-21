import { afterEach, describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Agenda from "@/pages/Agenda";
import { mondayOf } from "@/components/hearings/WeekBoard";
import { addDays, toISODate } from "@/lib/dates";
import { hearingFixture, meFixture, mockApi, page, renderAt } from "./api-mock";

afterEach(() => vi.unstubAllGlobals());

describe("Agenda page", () => {
  it("opens on the weekly board (Monday to Saturday) with the office's buttons on each card", async () => {
    window.localStorage.clear();
    const monday = mondayOf(new Date());
    const tuesday = toISODate(addDays(monday, 1));
    const h1 = hearingFixture("h1", "c3", "CC/2024/0512", "الهادي الطرابلسي", tuesday, "09:00", { type: "جلسة مرافعة" });
    const h2 = hearingFixture("h2", "c4", "CC/2025/0842", "شركة المتوسط للتجارة", tuesday, "09:00", { type: "جلسة استماع" });
    mockApi({
      "GET /api/v1/me": () => meFixture(),
      "GET /api/v1/hearings": () => page([h1, h2]),
    });
    renderAt("/app/agenda", [{ path: "/app/agenda", element: <Agenda /> }]);

    expect(await screen.findByText("هذا الأسبوع")).toBeInTheDocument();
    await screen.findAllByRole("article");
    // Six day columns, Monday first.
    const days = screen.getAllByRole("group").filter((g) => /^(الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت) /.test(g.getAttribute("aria-label") ?? ""));
    expect(days.map((d) => d.getAttribute("aria-label")!.split(" ")[0])).toEqual(["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]);
    // Both hearings sit in Tuesday's column, each with تأجيل / إلغاء / مسلّم.
    const card = within(days[1]).getByRole("article", { name: "جلسة استماع — شركة المتوسط للتجارة" });
    for (const name of ["تأجيل", "إلغاء", "مسلّم"]) expect(within(card).getByRole("button", { name })).toBeInTheDocument();
    expect(within(days[1]).getAllByRole("article")).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // The next week is empty; «العودة إلى هذا الأسبوع» brings the current week back.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "الأسبوع التالي" }));
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "العودة إلى هذا الأسبوع" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("keeps the month view one click away, with visible options and no time", async () => {
    window.localStorage.clear();
    const h = hearingFixture("h2", "c4", "CC/2025/0842", "شركة المتوسط للتجارة", "2031-03-03", "09:00", { type: "جلسة استماع" });
    mockApi({
      "GET /api/v1/me": () => meFixture(),
      "GET /api/v1/hearings": () => page([h]),
    });
    renderAt("/app/agenda", [{ path: "/app/agenda", element: <Agenda /> }]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "شهر" }));
    expect(await screen.findByText("شركة المتوسط للتجارة")).toBeInTheDocument();
    const options = screen.getByRole("group", { name: "إجراءات الجلسة: جلسة استماع" });
    for (const name of ["انعقدت", "تأجيل", "تعديل", "السجل"]) expect(within(options).getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    expect(screen.queryByText("09:00")).not.toBeInTheDocument();
  });

  it("reports a server failure instead of showing an empty agenda", async () => {
    mockApi({
      "GET /api/v1/me": () => meFixture(),
      "GET /api/v1/hearings": () => ({ status: 503, body: { error: { code: "SERVICE_UNAVAILABLE", message: "قاعدة البيانات غير متاحة حالياً. لم يُحفظ أي تغيير." } } }),
      "GET /api/v1/hearings/conflict-groups": () => [],
    });
    renderAt("/app/agenda", [{ path: "/app/agenda", element: <Agenda /> }]);
    expect(await screen.findByText("قاعدة البيانات غير متاحة حالياً. لم يُحفظ أي تغيير.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});
