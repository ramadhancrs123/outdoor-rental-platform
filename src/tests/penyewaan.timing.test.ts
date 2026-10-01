
import { describe, expect, it } from "vitest";
import {
  calculateDisplayLateFee,
  deriveRentalTiming,
  formatRentalCountdown,
} from "@/features/penyewaan/timing";

describe("rental timing", () => {
  const base = new Date("2026-10-01T10:00:00+07:00");

  it("shows before due countdown", () => {
    const snapshot = deriveRentalTiming(
      "2026-10-01T12:00:00+07:00",
      "2026-10-01T22:00:00+07:00",
      null,
      base,
    );
    expect(snapshot.state).toBe("before_due");
    expect(formatRentalCountdown(snapshot.remainingMs)).toBe("2j 00m");
  });

  it("shows remaining tolerance after scheduled return", () => {
    const snapshot = deriveRentalTiming(
      "2026-10-01T08:00:00+07:00",
      "2026-10-01T18:00:00+07:00",
      null,
      base,
    );
    expect(snapshot.state).toBe("in_tolerance");
    expect(snapshot.remainingMs).toBe(8 * 60 * 60 * 1000);
    expect(snapshot.overdueMs).toBe(2 * 60 * 60 * 1000);
  });

  it("shows overdue duration after tolerance", () => {
    const snapshot = deriveRentalTiming(
      "2026-10-01T08:00:00+07:00",
      "2026-10-01T09:00:00+07:00",
      null,
      base,
    );
    expect(snapshot.state).toBe("tolerance_expired");
    expect(snapshot.overdueMs).toBe(60 * 60 * 1000);
  });

  it("freezes late fee at actual return after completed return", () => {
    const snapshot = deriveRentalTiming(
      "2026-10-01T08:00:00+07:00",
      "2026-10-01T09:00:00+07:00",
      "2026-10-01T11:01:00+07:00",
      base,
    );
    expect(snapshot.state).toBe("returned");
    expect(snapshot.overdueMs).toBe(2 * 60 * 60 * 1000 + 60 * 1000);
    expect(calculateDisplayLateFee(true, 10000, snapshot)).toEqual({
      hours: 3,
      amount: 30000,
    });
  });

  it("does not calculate fee while feature is disabled", () => {
    const snapshot = deriveRentalTiming(
      "2026-10-01T08:00:00+07:00",
      "2026-10-01T09:00:00+07:00",
      null,
      base,
    );
    expect(calculateDisplayLateFee(false, 10000, snapshot)).toEqual({
      hours: 0,
      amount: 0,
    });
  });
});
