import { describe, expect, test } from "vitest";
import {
  formatFinanceTimezone,
  getFinanceBusinessDateOnly,
  getFinancePeriodSelection,
  getFinancePreviousDate,
  isValidFinanceDateOnly,
  semanticFinanceLabel,
} from "@/features/keuangan";

describe("Finance F3 contract", () => {
  test("period presets are based on the Usaha timezone", () => {
    const today = getFinancePeriodSelection("Asia/Jakarta", "today");
    expect(today.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(today.endDateExclusive).not.toBe(today.startDate);

    const month = getFinancePeriodSelection("Asia/Jakarta", "month");
    expect(month.startDate).toMatch(/-01$/);
    expect(month.endDateExclusive).toMatch(/-01$/);

    const custom = getFinancePeriodSelection("Asia/Jakarta", "custom", "2026-09-10", "2026-09-12");
    expect(custom).toEqual({
      preset: "custom",
      startDate: "2026-09-10",
      endDateExclusive: "2026-09-13",
      valid: true,
      validationMessage: null,
    });
    expect(getFinancePreviousDate(custom.endDateExclusive)).toBe("2026-09-12");
  });

  test("custom ranges reject malformed dates and reversed boundaries", () => {
    const reversed = getFinancePeriodSelection("Asia/Jakarta", "custom", "2026-09-13", "2026-09-12");
    expect(reversed.valid).toBe(false);
    expect(reversed.validationMessage).toContain("tidak boleh melewati");

    const malformed = getFinancePeriodSelection("Asia/Jakarta", "custom", "2026-02-31", "2026-03-01");
    expect(malformed.valid).toBe(false);
    expect(isValidFinanceDateOnly("2026-02-31")).toBe(false);
    expect(isValidFinanceDateOnly("2026-02-28")).toBe(true);
  });

  test("expense date defaults follow business timezone, not UTC date", () => {
    expect(getFinanceBusinessDateOnly("Asia/Jakarta", new Date("2026-10-10T17:30:00.000Z"))).toBe("2026-10-11");
  });

  test("finance status language avoids accounting profit semantics", () => {
    expect(semanticFinanceLabel("recorded_income")).toBe("Recorded Income");
    expect(formatFinanceTimezone("Asia/Jakarta")).toContain("Asia/Jakarta");
  });
});
