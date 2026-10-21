/**
 * TEST DOUBLE for the office API: stubs `fetch` with route handlers returning realistic DTOs.
 * Used only by component tests; the application never fabricates API responses.
 */
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { CaseSummaryDTO, DashboardDTO, HearingDTO, MeDTO, PERMISSIONS, TaskDTO } from "../../shared/api";

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
}
type Handler = (req: MockRequest) => { status?: number; body: unknown } | unknown;

export function mockApi(routes: Record<string, Handler>) {
  const calls: MockRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const req: MockRequest = { method, path: url.pathname, query: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) };
    calls.push(req);
    const key = Object.keys(routes).find((pattern) => {
      const [m, p] = pattern.split(" ");
      if (m !== method) return false;
      const re = new RegExp(`^${p.replace(/:[a-zA-Z]+/g, "[^/]+")}$`);
      return re.test(url.pathname);
    });
    if (!key) return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "غير موجود (اختبار)" } }), { status: 404, headers: { "Content-Type": "application/json" } });
    const result = routes[key](req) as { status?: number; body?: unknown } | undefined;
    const wrapped = result && typeof result === "object" && "body" in result ? result : { status: 200, body: result };
    return new Response(JSON.stringify(wrapped.body ?? null), { status: wrapped.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

export function renderAt(url: string, routes: { path: string; element: React.ReactNode }[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          <Route path="*" element={<div>صفحة أخرى</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ——— Fixtures ———

type Permission = (typeof PERMISSIONS)[number];
const LAWYER_PERMISSIONS: Permission[] = [
  "client:read", "client:write", "case:read", "case:create", "case:update", "case:status", "case:assign", "note:write",
  "hearing:write", "hearing:cancel", "finance:read", "finance:write", "payment:record", "payment:void", "task:write",
];

export function meFixture(role: MeDTO["role"] = "lawyer", permissions: Permission[] = LAWYER_PERMISSIONS): MeDTO {
  return {
    user: { id: "u-lawyer", name: "الأستاذ منير العياري", email: "m.ayari@ayari.example", twoFactorEnabled: false },
    office: { id: "org-1", name: "مكتب الأستاذ منير العياري للمحاماة", timeZone: "Africa/Tunis", defaultCurrency: "TND" },
    role,
    permissions,
    offices: [{ id: "org-1", name: "مكتب الأستاذ منير العياري للمحاماة", role }],
    mail: { configured: false },
  };
}

export const clerkPermissions: Permission[] = ["client:read", "client:write", "case:read", "case:create", "case:update", "note:write", "hearing:write", "task:write"];

const lawyer = { userId: "u-lawyer", name: "الأستاذ منير العياري" };

export function caseFixture(id: string, reference: string, client: string, status: CaseSummaryDTO["status"] = "ACTIVE", type: CaseSummaryDTO["type"] = "CIVIL"): CaseSummaryDTO {
  return {
    id,
    reference,
    type,
    status,
    court: "محكمة التعقيب — الدائرة المدنية",
    chamber: null,
    openedOn: "2025-01-15",
    closedOn: null,
    assignedLawyer: lawyer,
    clients: [{ id: `cl-${id}`, fullName: client, role: "PRINCIPAL" }],
    nextHearing: null,
    version: 1,
    updatedAt: "2026-10-01T09:00:00.000Z",
  };
}

export function hearingFixture(id: string, caseId: string, reference: string, client: string, date: string, time: string, extra: Partial<HearingDTO> = {}): HearingDTO {
  return {
    id,
    caseId,
    caseReference: reference,
    clientName: client,
    assignedLawyer: lawyer,
    startsAt: `${date}T${time}:00.000Z`,
    date,
    time,
    timeZone: "Africa/Tunis",
    durationMinutes: 60,
    court: "قصر العدالة بتونس",
    chamber: null,
    room: "قاعة 2",
    type: "جلسة حكم",
    status: "SCHEDULED",
    notes: null,
    version: 1,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
    ...extra,
  };
}

export function taskFixture(id: string, title: string, dueDate: string, extra: Partial<TaskDTO> = {}): TaskDTO {
  return {
    id,
    kind: "TASK",
    title,
    description: null,
    case: null,
    hearingId: null,
    assignee: lawyer,
    dueDate,
    dueTime: null,
    dueAt: null,
    priority: "HIGH",
    status: "OPEN",
    recurrence: "NONE",
    notifyInApp: true,
    notifyEmail: false,
    completedAt: null,
    createdBy: lawyer,
    createdAt: "2026-10-01T09:00:00.000Z",
    version: 1,
    reminders: [],
    ...extra,
  };
}

export const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: items.length || 20, total: items.length });

export function dashboardFixture(today: string, extra: Partial<DashboardDTO> = {}): DashboardDTO {
  return {
    today,
    activeCases: 4,
    hearingsNext7Days: [],
    todayTasks: [],
    overdueTaskCount: 0,
    conflictGroups: [],
    caseTypeDistribution: [
      { type: "INHERITANCE", count: 2 },
      { type: "CIVIL", count: 1 },
    ],
    recentCases: [caseFixture("c1", "CC/2025/0124", "عائلة بن صالح", "ACTIVE", "INHERITANCE")],
    outstanding: [{ currency: "TND", amount: "11500.000" }],
    ...extra,
  };
}
