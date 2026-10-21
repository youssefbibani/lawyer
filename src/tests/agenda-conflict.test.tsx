import { afterEach, describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";

import Agenda from "@/pages/Agenda";
import { hearingFixture, meFixture, mockApi, page, renderAt } from "./api-mock";

afterEach(() => vi.unstubAllGlobals());

describe("Agenda page", () => {
  it("shows a conflict alert for hearings of the same lawyer at the same date and time", async () => {
    const h1 = hearingFixture("h1", "c3", "CC/2024/0512", "الهادي الطرابلسي", "2031-03-03", "09:00");
    const h2 = hearingFixture("h2", "c4", "CC/2025/0842", "شركة المتوسط للتجارة", "2031-03-03", "09:00", { type: "جلسة استماع" });
    mockApi({
      "GET /api/v1/me": () => meFixture(),
      "GET /api/v1/hearings": () => page([h1, h2]),
      "GET /api/v1/hearings/conflict-groups": () => [[h1, h2]],
    });
    renderAt("/app/agenda", [{ path: "/app/agenda", element: <Agenda /> }]);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("تنبيه: يوجد تعارض بين جلستين للمحامي نفسه")).toBeInTheDocument();
    expect(alert.textContent).toContain("CC/2024/0512");
    expect(alert.textContent).toContain("CC/2025/0842");
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
