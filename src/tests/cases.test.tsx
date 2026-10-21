import { afterEach, describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useParams } from "react-router-dom";

import Cases from "@/pages/Cases";
import { caseFixture, meFixture, mockApi, page, renderAt } from "./api-mock";

afterEach(() => vi.unstubAllGlobals());

function CaseIdMarker() {
  const { id } = useParams<{ id: string }>();
  return <div>معرف القضية: {id}</div>;
}

const CASES = [
  caseFixture("c1", "CC/2025/0124", "عائلة بن صالح", "ACTIVE", "INHERITANCE"),
  caseFixture("c2", "CC/2025/0398", "سامي مراد"),
  caseFixture("c3", "CC/2024/0512", "الهادي الطرابلسي", "ACTIVE", "CASSATION"),
  caseFixture("c4", "CC/2025/0842", "شركة المتوسط للتجارة", "ACTIVE", "COMMERCIAL"),
  caseFixture("c5", "CC/2025/0211", "ليلى الشابي", "POSTPONED", "REAL_ESTATE"),
];

/** Mirrors the server's filtering so the page's query parameters are exercised. */
function setup() {
  const api = mockApi({
    "GET /api/v1/me": () => meFixture(),
    "GET /api/v1/cases": (req) => {
      const q = req.query.get("q") ?? "";
      const status = req.query.get("status");
      return page(CASES.filter((c) => (!status || c.status === status) && (!q || `${c.reference} ${c.clients[0].fullName}`.includes(q))));
    },
  });
  renderAt("/app/cases", [
    { path: "/app/cases", element: <Cases /> },
    { path: "/app/cases/:id", element: <CaseIdMarker /> },
  ]);
  return api;
}

describe("Cases page", () => {
  it("renders the office's cases from the server", async () => {
    setup();
    expect(await screen.findByText("عائلة بن صالح")).toBeInTheDocument();
    for (const name of ["سامي مراد", "الهادي الطرابلسي", "شركة المتوسط للتجارة", "ليلى الشابي"]) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByText("5 قضية")).toBeInTheDocument();
  });

  it("filters cases by status on the server", async () => {
    const { calls } = setup();
    const user = userEvent.setup();
    await screen.findByText("عائلة بن صالح");
    await user.click(screen.getByRole("button", { name: "مؤجلة" }));
    await waitFor(() => expect(screen.queryByText("عائلة بن صالح")).not.toBeInTheDocument());
    expect(screen.getByText("ليلى الشابي")).toBeInTheDocument();
    expect(screen.getByText("1 قضية")).toBeInTheDocument();
    expect(calls.some((c) => c.path === "/api/v1/cases" && c.query.get("status") === "POSTPONED")).toBe(true);
  });

  it("searches cases by client name", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText("عائلة بن صالح");
    await user.type(screen.getByPlaceholderText("ابحث بالحريف، المرجع، المحكمة..."), "مراد");
    await waitFor(() => expect(screen.queryByText("عائلة بن صالح")).not.toBeInTheDocument());
    expect(screen.getByText("سامي مراد")).toBeInTheDocument();
  });

  it("searches cases by reference", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText("عائلة بن صالح");
    await user.type(screen.getByPlaceholderText("ابحث بالحريف، المرجع، المحكمة..."), "CC/2024/0512");
    await waitFor(() => expect(screen.queryByText("سامي مراد")).not.toBeInTheDocument());
    expect(screen.getByText("الهادي الطرابلسي")).toBeInTheDocument();
  });

  it("navigates to the case detail page when a row is clicked", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByText("عائلة بن صالح"));
    expect(await screen.findByText("معرف القضية: c1")).toBeInTheDocument();
  });
});
