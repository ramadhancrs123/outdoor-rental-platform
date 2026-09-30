import { describe, expect, test } from "vitest";
import {
  formatFinanceTimezone,
  getFinancePeriodSelection,
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
    });
  });

  test("finance status language avoids accounting profit semantics", () => {
    expect(semanticFinanceLabel("recorded_income")).toBe("Recorded Income");
    expect(formatFinanceTimezone("Asia/Jakarta")).toContain("Asia/Jakarta");
  });
});
