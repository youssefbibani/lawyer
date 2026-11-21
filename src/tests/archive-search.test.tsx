import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import ArchiveSearch from "@/pages/ArchiveSearch";

function renderArchiveSearch() {
  return render(
    <MemoryRouter>
      <ArchiveSearch />
    </MemoryRouter>,
  );
}

describe("Archive search page", () => {
  it("renders the search form", () => {
    renderArchiveSearch();
    expect(
      screen.getByPlaceholderText("ابحث بكلمة أو عبارة: ميراث، طلاق، عقار، صفاقس 2019…"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "بحث" })).toBeInTheDocument();
  });

  it("shows a loading state, then three ranked results with relevance badges", async () => {
    renderArchiveSearch();
    const user = userEvent.setup();

    await user.type(
      screen.getByPlaceholderText("ابحث بكلمة أو عبارة: ميراث، طلاق، عقار، صفاقس 2019…"),
      "ميراث",
    );
    await user.click(screen.getByRole("button", { name: "بحث" }));

    expect(screen.getByText("جارٍ البحث...")).toBeInTheDocument();

    expect(
      await screen.findByText("تم العثور على 3 نتائج", {}, { timeout: 2000 }),
    ).toBeInTheDocument();

    expect(screen.getByText("قوي")).toBeInTheDocument();
    expect(screen.getByText("متوسط")).toBeInTheDocument();
    expect(screen.getByText("جزئي")).toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: "عرض الوثيقة" })).toHaveLength(3);
  });

  it("applies a filter at once, offers a reset, and remembers recent searches", async () => {
    window.localStorage.clear();
    renderArchiveSearch();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ميراث/ }));
    expect(await screen.findByText("تم العثور على 3 نتائج", {}, { timeout: 2000 })).toBeInTheDocument();

    // Changing the language re-runs the search without pressing «بحث».
    await user.click(screen.getByRole("radio", { name: "Français" }));
    expect(screen.getByText("جارٍ البحث...")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /إعادة ضبط المرشحات/ }));
    expect(screen.getByRole("radio", { name: "الكل" })).toHaveAttribute("aria-checked", "true");

    // Clearing goes back to the start screen, where the search is listed as recent.
    await user.click(screen.getByRole("button", { name: "مسح البحث" }));
    expect(screen.getByText("عمليات بحث أخيرة")).toBeInTheDocument();
  });
});
