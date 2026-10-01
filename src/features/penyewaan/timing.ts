export type RentalTimingState =
  | "before_due"
  | "due"
  | "in_tolerance"
  | "tolerance_expired"
  | "returned";

export type RentalTimingSnapshot = {
  state: RentalTimingState;
  scheduleAt: string;
  toleranceDeadline: string | null;
  actualReturnAt: string | null;
  remainingMs: number;
  overdueMs: number;
};

export function deriveRentalTiming(
  scheduleAt: string,
  toleranceDeadline: string | null,
  actualReturnAt: string | null = null,
  now = new Date(),
): RentalTimingSnapshot {
  const scheduleMs = new Date(scheduleAt).getTime();
  const toleranceMs = toleranceDeadline ? new Date(toleranceDeadline).getTime() : Number.NaN;
  const actualMs = actualReturnAt ? new Date(actualReturnAt).getTime() : Number.NaN;
  const nowMs = now.getTime();

  if (Number.isFinite(actualMs)) {
    return {
      state: "returned",
      scheduleAt,
      toleranceDeadline,
      actualReturnAt,
      remainingMs: 0,
      overdueMs: Number.isFinite(toleranceMs) ? Math.max(0, actualMs - toleranceMs) : 0,
    };
  }

  if (!Number.isFinite(scheduleMs)) {
    return {
      state: "before_due",
      scheduleAt,
      toleranceDeadline,
      actualReturnAt,
      remainingMs: 0,
      overdueMs: 0,
    };
  }

  if (nowMs < scheduleMs) {
    return {
      state: "before_due",
      scheduleAt,
      toleranceDeadline,
      actualReturnAt,
      remainingMs: scheduleMs - nowMs,
      overdueMs: 0,
    };
  }

  if (!Number.isFinite(toleranceMs)) {
    return {
      state: "due",
      scheduleAt,
      toleranceDeadline,
      actualReturnAt,
      remainingMs: 0,
      overdueMs: nowMs - scheduleMs,
    };
  }

  if (nowMs <= toleranceMs) {
    return {
      state: "in_tolerance",
      scheduleAt,
      toleranceDeadline,
      actualReturnAt,
      remainingMs: toleranceMs - nowMs,
      overdueMs: Math.max(0, nowMs - scheduleMs),
    };
  }

  return {
    state: "tolerance_expired",
    scheduleAt,
    toleranceDeadline,
    actualReturnAt,
    remainingMs: 0,
    overdueMs: nowMs - toleranceMs,
  };
}

export function formatRentalCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return days + "h " + String(hours).padStart(2, "0") + "j";
  if (hours > 0) return hours + "j " + String(minutes).padStart(2, "0") + "m";
  if (minutes > 0) return minutes + "m " + String(seconds).padStart(2, "0") + "d";
  return seconds + "d";
}

export function calculateDisplayLateFee(
  enabled: boolean,
  hourlyRate: number,
  timing: RentalTimingSnapshot,
) {
  if (!enabled || hourlyRate <= 0 || timing.overdueMs <= 0) return { hours: 0, amount: 0 };
  const hours = Math.ceil(timing.overdueMs / 3_600_000);
  return { hours, amount: hours * hourlyRate };
}

export function rentalTimingLabel(state: RentalTimingState) {
  switch (state) {
    case "before_due":
      return "Belum jatuh tempo";
    case "due":
      return "Jatuh tempo";
    case "in_tolerance":
      return "Dalam toleransi";
    case "tolerance_expired":
      return "Toleransi berakhir";
    case "returned":
      return "Sudah dikembalikan";
  }
}

export function rentalTimingTone(state: RentalTimingState) {
  if (state === "tolerance_expired") return "danger" as const;
  if (state === "in_tolerance") return "warning" as const;
  if (state === "due") return "warning" as const;
  if (state === "returned") return "success" as const;
  return "neutral" as const;
}
