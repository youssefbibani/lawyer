import { describe, expect, it } from "vitest";

import { isoToDisplay, parseTypedDate } from "@/components/shared/DateField";

describe("typed dates (day first, as written in Tunisia)", () => {
  it("reads the usual ways of writing a date", () => {
    expect(parseTypedDate("05/05/2026")).toBe("2026-05-05");
    expect(parseTypedDate("5/5/2026")).toBe("2026-05-05");
    expect(parseTypedDate("5-5-26")).toBe("2026-05-05");
    expect(parseTypedDate("18.12.2026")).toBe("2026-12-18");
    expect(parseTypedDate("18 12 2026")).toBe("2026-12-18");
    expect(parseTypedDate("05052026")).toBe("2026-05-05");
    expect(parseTypedDate("050526")).toBe("2026-05-05");
    expect(parseTypedDate("١٨/١٢/٢٠٢٦")).toBe("2026-12-18");
  });

  it("refuses days that do not exist or odd years", () => {
    expect(parseTypedDate("31/02/2026")).toBeNull();
    expect(parseTypedDate("05/13/2026")).toBeNull();
    expect(parseTypedDate("05/05/0005")).toBeNull();
    expect(parseTypedDate("05/05/202")).toBeNull();
    expect(parseTypedDate("غدا")).toBeNull();
    expect(parseTypedDate("")).toBeNull();
  });

  it("shows ISO dates as dd/mm/yyyy", () => {
    expect(isoToDisplay("2026-05-05")).toBe("05/05/2026");
    expect(isoToDisplay("")).toBe("");
  });
});
