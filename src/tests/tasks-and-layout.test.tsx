import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import Tasks from "@/pages/Tasks";
import DocumentViewer from "@/pages/DocumentViewer";
import Dashboard from "@/pages/Dashboard";
import Payments from "@/pages/Payments";
import { BottomNav } from "@/components/layout/BottomNav";
import { getDB } from "@/services/db";
import { createTask, findTaskConflicts, setTaskCompleted } from "@/services/api";
import { toISODate } from "@/lib/dates";
import { clerkPermissions, dashboardFixture, meFixture, mockApi, page, renderAt, taskFixture } from "./api-mock";

afterEach(() => vi.unstubAllGlobals());

function at(url: string, path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="*" element={<div>صفحة أخرى</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("tasks & reminders", () => {
  const overdue = taskFixture("k1", "مراجعة تقرير الاختبار العقاري قبل الجلسة", "2020-01-01", { case: { id: "c1", reference: "CC/2025/0124", clientName: "عائلة بن صالح" } });

  function setupTasks() {
    return mockApi({
      "GET /api/v1/me": () => meFixture(),
      "GET /api/v1/members": () => [{ userId: "u-lawyer", name: "الأستاذ منير العياري", email: "m.ayari@ayari.example", role: "lawyer", phone: null, barNumber: null, active: true, deactivatedAt: null, createdAt: "2026-01-01T00:00:00Z" }],
      "GET /api/v1/cases": () => page([]),
      "GET /api/v1/tasks/summary": () => ({ today: 0, upcoming: 2, overdue: 1, done: 3 }),
      "GET /api/v1/tasks": (req) => page(req.query.get("bucket") === "overdue" ? [overdue] : []),
      "POST /api/v1/tasks/:id/complete": () => ({ task: { ...overdue, status: "DONE", version: 2 }, next: null }),
    });
  }

  it("groups tasks into today / upcoming / overdue / done tabs with server counts", async () => {
    setupTasks();
    renderAt("/app/tasks", [{ path: "/app/tasks", element: <Tasks /> }]);
    expect(screen.getByRole("tab", { name: /اليوم/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("tab", { name: /المتأخرة/ })).toHaveTextContent("1"));
    expect(await screen.findByText("مراجعة تقرير الاختبار العقاري قبل الجلسة")).toBeInTheDocument();
  });

  it("completing a task sends the expected version to the server", async () => {
    const { calls } = setupTasks();
    renderAt("/app/tasks", [{ path: "/app/tasks", element: <Tasks /> }]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "إنجاز: مراجعة تقرير الاختبار العقاري قبل الجلسة" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/tasks/k1/complete")).toBe(true));
    expect(calls.find((c) => c.path === "/api/v1/tasks/k1/complete")?.body).toEqual({ version: 1 });
  });

  it("completing a recurring reminder schedules the next occurrence", () => {
    const before = getDB().tasks.length;
    const r = setTaskCompleted("k6", true);
    expect(r.ok && r.data.spawned).toBeTruthy();
    expect(getDB().tasks.length).toBe(before + 1);
  });

  it("detects conflicts with hearings at the same time", () => {
    const h1 = getDB().hearings.find((h) => h.id === "h1")!;
    const { hearings } = findTaskConflicts({ dueDate: h1.date, dueTime: "09:15", assigneeId: "u1" });
    expect(hearings.map((h) => h.id)).toContain("h1");
  });

  it("rejects tasks linked to cases the user cannot access", () => {
    const r = createTask({
      kind: "task", title: "اختبار", caseId: "6", assigneeId: "u1", dueDate: toISODate(new Date()),
      priority: "medium", channels: { inApp: true, email: false, sms: false }, recurrence: "none",
    });
    expect(r.ok).toBe(false);
  });
});

describe("document viewer", () => {
  it("opens a cited page with in-document search results", async () => {
    at("/app/document/a1?page=2&q=الميراث", "/app/document/:docId", <DocumentViewer />);
    expect(screen.getByRole("region", { name: "الصفحة 2" })).toBeInTheDocument();
    expect(screen.getByLabelText("البحث داخل الوثيقة")).toHaveValue("الميراث");
    expect(screen.getAllByText(/الميراث/, { selector: "mark" }).length).toBeGreaterThan(0);
  });

  it("refuses documents from files the user is not staffed on", () => {
    at("/app/document/a4", "/app/document/:docId", <DocumentViewer />);
    expect(screen.getByText("الوثيقة غير متاحة")).toBeInTheDocument();
  });

  it("warns about instruction-like content in external documents", () => {
    at("/app/document/d6", "/app/document/:docId", <DocumentViewer />);
    expect(screen.getByText(/تشبه تعليمات موجّهة لأنظمة آلية/)).toBeInTheDocument();
  });
});

describe("navigation & permissions", () => {
  it("bottom navigation exposes key sections and a menu for the rest", async () => {
    at("/app", "/app", <BottomNav />);
    const nav = screen.getByRole("navigation", { name: "التنقل السريع" });
    for (const label of ["الرئيسية", "القضايا", "المساعد", "الجلسات"]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
    const user = userEvent.setup();
    await user.click(within(nav).getByRole("button", { name: "المزيد" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("link", { name: /المهام والتذكيرات/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: /الأتعاب/ })).toBeInTheDocument();
  });

  it("hides financial data from a clerk (server permissions)", async () => {
    mockApi({ "GET /api/v1/me": () => meFixture("clerk", clerkPermissions) });
    renderAt("/app/payments", [{ path: "/app/payments", element: <Payments /> }]);
    expect(await screen.findByText("غير مصرّح")).toBeInTheDocument();
  });

  it("renders the dashboard in Arabic with live data", async () => {
    mockApi({ "GET /api/v1/me": () => meFixture(), "GET /api/v1/dashboard": () => dashboardFixture(toISODate(new Date())) });
    renderAt("/app", [{ path: "/app", element: <Dashboard /> }]);
    expect(screen.getByRole("heading", { name: "لوحة التحكم" })).toBeInTheDocument();
    expect(await screen.findByText("مهام اليوم", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("11,500 د.ت")).toBeInTheDocument();
    // No visible Latin UI words (technical refs like CC/… or د.ت are allowed).
    const visible = document.body.textContent ?? "";
    const latinWords = visible.replace(/CC\/\d{4}\/\d{4}|Ctrl K|SMS|PDF|OCR|FR|[A-Z]{2,3}-\d{4}-\d{4}/g, "").match(/[A-Za-z]{3,}/g) ?? [];
    expect(latinWords).toEqual([]);
  });
});
