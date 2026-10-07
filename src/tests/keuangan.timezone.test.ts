import { describe, expect, test } from "vitest";
import { localDateTimeToUtcIso } from "@/features/keuangan/utils";

describe("Finance business timezone", () => {
  test("converts Asia/Jakarta business time to UTC before persistence", () => {
    expect(localDateTimeToUtcIso("2026-10-04T09:34", "Asia/Jakarta")).toBe("2026-10-04T02:34:00.000Z");
  });

  test("preserves UTC wall clock when timezone is UTC", () => {
    expect(localDateTimeToUtcIso("2026-10-04T09:34", "UTC")).toBe("2026-10-04T09:34:00.000Z");
  });
});
