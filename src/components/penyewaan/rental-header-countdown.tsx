import { useEffect, useMemo, useState } from "react";
import { Clock3 } from "lucide-react";
import { deriveRentalTiming } from "@/features/penyewaan/timing";

type Props = {
  rentalStatus: string;
  scheduleAt: string;
  toleranceDeadline: string | null;
  actualReturnAt?: string | null;
};

function formatPreciseDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  const clock = [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
  if (days > 0) return String(days) + " hari " + clock;
  return [Math.floor(seconds / 3_600), minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

export function RentalHeaderCountdown({ rentalStatus, scheduleAt, toleranceDeadline, actualReturnAt = null }: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const timing = useMemo(
    () => deriveRentalTiming(scheduleAt, toleranceDeadline, actualReturnAt, now),
    [scheduleAt, toleranceDeadline, actualReturnAt, now],
  );

  if (rentalStatus !== "active" && rentalStatus !== "return_in_progress") return null;
  if (timing.state === "returned") return null;

  const isOverdue = timing.state === "due" || timing.state === "tolerance_expired";
  const duration = isOverdue ? timing.overdueMs : timing.remainingMs;
  const sublabel = timing.state === "before_due"
    ? "Sampai jadwal kembali"
    : timing.state === "in_tolerance"
      ? "Sampai batas toleransi"
      : timing.state === "due"
        ? "Melewati jadwal kembali"
        : "Melewati batas toleransi";
  const boxTone = isOverdue
    ? "border-rose-100/30 bg-rose-950/25"
    : timing.state === "in_tolerance"
      ? "border-amber-100/30 bg-amber-950/20"
      : "border-white/20 bg-black/15";

  return (
    <div
      data-testid="rental-header-countdown"
      aria-label={(isOverdue ? "Keterlambatan berjalan: " : "Waktu tersisa: ") + formatPreciseDuration(duration)}
      className={"mt-3 flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 backdrop-blur-sm " + boxTone}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/12 text-white">
          <Clock3 className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold leading-4 text-white">
            {isOverdue ? "Keterlambatan berjalan" : "Waktu tersisa"}
          </p>
          <p className="mt-0.5 text-[9px] leading-3.5 text-white/75">{sublabel}</p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-[17px] font-bold leading-5 tracking-tight tabular-nums text-white sm:text-[19px]">
          {formatPreciseDuration(duration)}
        </p>
        <p className="mt-0.5 text-[8px] text-white/65">{isOverdue ? "durasi terlambat" : "hari · jam · menit · detik"}</p>
      </div>
    </div>
  );
}
