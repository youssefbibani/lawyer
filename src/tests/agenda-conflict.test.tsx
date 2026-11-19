import { afterEach, describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";

import Agenda from "@/pages/Agenda";
import { hearingFixture, meFixture, mockApi, page, renderAt } from "./api-mock";

afterEach(() => vi.unstubAllGlobals());

describe("Agenda page", () => {
  it("lists two hearings on the same day without a clash alert, with visible options and no time", async () => {
    const h1 = hearingFixture("h1", "c3", "CC/2024/0512", "الهادي الطرابلسي", "2031-03-03", "09:00");
    const h2 = hearingFixture("h2", "c4", "CC/2025/0842", "شركة المتوسط للتجارة", "2031-03-03", "09:00", { type: "جلسة استماع" });
    mockApi({
      "GET /api/v1/me": () => meFixture(),
      "GET /api/v1/hearings": () => page([h1, h2]),
    });
    renderAt("/app/agenda", [{ path: "/app/agenda", element: <Agenda /> }]);

    expect(await screen.findByText("شركة المتوسط للتجارة")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Hearing options are buttons on the card, not a hidden menu.
    const options = screen.getByRole("group", { name: "إجراءات الجلسة: جلسة استماع" });
    for (const name of ["انعقدت", "تأجيل", "تعديل", "السجل"]) expect(within(options).getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    // No reminder-channel settings box, no time shown.
    expect(screen.queryByText("تذكير ذكي")).not.toBeInTheDocument();
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
