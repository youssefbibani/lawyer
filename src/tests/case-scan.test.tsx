import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NewCaseDialog } from "@/components/cases/NewCaseDialog";
import { setOcrProvider, getOcrProvider, type OcrProvider } from "@/services/archive/ocr";
import { inferCaseType, suggestionsFromText } from "@/services/cases/scan";
import { meFixture, mockApi, page, renderAt } from "./api-mock";

/** A court summons as the OCR engine would return it. */
const SUMMONS = [
  "الجمهورية التونسية",
  "استدعاء للحضور بجلسة",
  "المحكمة الابتدائية بتونس",
  "القضية عدد 45821/2026",
  "في حق: عائلة بن صالح",
  "ضد: شركة المتوسط للتجارة",
  "موضوع الدعوى: قسمة تركة المرحوم",
  "يتعيّن الحضور بجلسة يوم 12/01/2027 على الساعة التاسعة صباحاً",
].join("\n");

const original = getOcrProvider();
afterEach(() => {
  setOcrProvider(original);
  vi.unstubAllGlobals();
});

describe("reading a photographed document", () => {
  it("suggests the case number, client, type, court, next hearing and a short description", () => {
    const s = suggestionsFromText(SUMMONS, 90, [], "2026-11-21");
    const byKey = Object.fromEntries(s.map((x) => [x.key, x]));
    expect(byKey.reference.value).toBe("45821/2026");
    expect(byKey.clientName.value).toBe("عائلة بن صالح");
    expect(byKey.type).toMatchObject({ value: "INHERITANCE", display: "نزاع ميراث" });
    expect(byKey.court.value).toBe("المحكمة الابتدائية بتونس");
    expect(byKey.hearingDate.value).toBe("2027-01-12");
    expect(byKey.description.value).toBe("استدعاء للحضور بجلسة");
  });

  it("does not offer a past date as the next hearing, and guesses no type without clues", () => {
    const s = suggestionsFromText("المحكمة الابتدائية بتونس\nبتاريخ 03/02/2019", 90, [], "2026-11-21");
    expect(s.find((x) => x.key === "hearingDate")).toBeUndefined();
    expect(inferCaseType("نص عام بدون مؤشرات")).toBeNull();
    expect(inferCaseType("دعوى طلاق ونفقة")?.type).toBe("FAMILY");
  });
});

describe("new case form — fill from a photo", () => {
  it("fills only the approved fields, marks them, and can undo", async () => {
    const fake: OcrProvider = { id: "fake", label: "fake", local: true, recognize: async () => ({ text: SUMMONS, confidence: 92, words: [] }) };
    setOcrProvider(fake);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined }));
    mockApi({
      "GET /api/v1/me": () => meFixture(),
      "GET /api/v1/members": () => [],
      "GET /api/v1/clients": () => page([]),
    });
    renderAt("/x", [{ path: "/x", element: <NewCaseDialog open onOpenChange={() => undefined} /> }]);
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog");

    // The camera icon button is at the top of the form.
    expect(within(dialog).getByRole("button", { name: "تصوير وثيقة" })).toBeInTheDocument();
    const file = new File(["x"], "summons.jpg", { type: "image/jpeg" });
    await user.upload(dialog.querySelector('input[type="file"]:not([capture])') as HTMLInputElement, file);

    // Review step: nothing filled yet.
    expect(await within(dialog).findByText("راجع ما قرأناه من الوثيقة")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("المحكمة", { selector: "#nc-court" })).toHaveValue("");
    // Low-reliability values start unticked; the lawyer also drops the hearing date and corrects the number.
    expect(within(dialog).getByRole("checkbox", { name: "استعمال وصف مختصر" })).not.toBeChecked();
    await user.click(within(dialog).getByRole("checkbox", { name: "استعمال الجلسة الأولى" }));
    const ref = within(dialog).getAllByRole("textbox", { name: "عدد القضية" })[0];
    await user.clear(ref);
    await user.type(ref, "45821/2026-B");
    await user.click(within(dialog).getByRole("button", { name: "تعبئة الخانات المختارة" }));

    expect(within(dialog).getByText(/تمت تعبئة \d خانات من الوثيقة/)).toBeInTheDocument();
    expect(dialog.querySelector("#nc-court")).toHaveValue("المحكمة الابتدائية بتونس");
    expect(dialog.querySelector("#nc-ref")).toHaveValue("45821/2026-B");
    expect(dialog.querySelector("#nc-client")).toHaveValue("عائلة بن صالح");
    expect(dialog.querySelector("#nc-desc")).toHaveValue("");
    expect(dialog.querySelector("#nc-hdate")).toHaveValue("");
    expect(within(dialog).getAllByText("من الوثيقة")).toHaveLength(4); // number, client, type, court

    // Undo restores the empty form.
    await user.click(within(dialog).getByRole("button", { name: "تراجع" }));
    await waitFor(() => expect(dialog.querySelector("#nc-court")).toHaveValue(""));
    expect(within(dialog).queryByText("من الوثيقة")).not.toBeInTheDocument();
  });
});
