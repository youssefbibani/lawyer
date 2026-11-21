import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Settings from "@/pages/Settings";
import { clerkPermissions, meFixture, mockApi, renderAt } from "./api-mock";

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-accent");
  document.documentElement.removeAttribute("data-font-size");
});

const sections = () => within(screen.getByRole("navigation", { name: "أقسام الإعدادات" })).getAllByRole("button").map((b) => b.textContent);

describe("Settings", () => {
  it("is split into sections; office admin sections are hidden from a clerk", async () => {
    mockApi({ "GET /api/v1/me": () => meFixture("clerk", clerkPermissions) });
    renderAt("/app/settings", [{ path: "/app/settings", element: <Settings /> }]);
    await screen.findByRole("heading", { name: "حسابي والأمان" });
    expect(sections()).toEqual(["حسابي والأمان", "المظهر", "الإشعارات", "المكتب", "المساعد الذكي", "الوضع التجريبي"]);
  });

  it("opens a section from the link and applies appearance choices at once (no dead options)", async () => {
    window.localStorage.clear();
    mockApi({ "GET /api/v1/me": () => meFixture() });
    renderAt("/app/settings?tab=appearance", [{ path: "/app/settings", element: <Settings /> }]);
    expect(await screen.findByRole("heading", { name: "المظهر" })).toBeInTheDocument();
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: /داكن/ }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await user.click(screen.getByRole("radio", { name: /أحمر/ }));
    expect(document.documentElement.getAttribute("data-accent")).toBe("red");
    await user.click(screen.getByRole("radio", { name: /كبير/ }));
    expect(document.documentElement.getAttribute("data-font-size")).toBe("large");

    // Removed: settings that did nothing.
    expect(screen.queryByText("كثافة الواجهة")).not.toBeInTheDocument();
    expect(screen.queryByText("اللغة")).not.toBeInTheDocument();
  });
});
