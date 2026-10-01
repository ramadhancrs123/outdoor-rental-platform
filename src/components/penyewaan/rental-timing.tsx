import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  calculateDisplayLateFee,
  deriveRentalTiming,
  formatRentalCountdown,
  rentalTimingLabel,
  rentalTimingTone,
} from "@/features/penyewaan/timing";
import { formatRentalDateTime, formatRentalMoney } from "@/features/penyewaan/utils";

type Props = {
  scheduleAt: string;
  toleranceDeadline: string | null;
  actualReturnAt?: string | null;
  lateFeeEnabled?: boolean;
  lateFeePerHour?: number;
  compact?: boolean;
  refreshMs?: number;
  className?: string;
};

function toneClasses(tone: ReturnType<typeof rentalTimingTone>) {
  if (tone === "danger") return "border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100";
  if (tone === "warning") return "border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100";
  if (tone === "success") return "border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100";
  return "border-border bg-muted/30 text-foreground";
}

export function RentalTimingSummary({
  scheduleAt,
  toleranceDeadline,
  actualReturnAt = null,
  lateFeeEnabled = false,
  lateFeePerHour = 0,
  compact = false,
  refreshMs = 1000,
  className,
}: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (refreshMs <= 0) return;
    const timer = window.setInterval(() => setNow(new Date()), refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshMs]);

  const timing = useMemo(
    () => deriveRentalTiming(scheduleAt, toleranceDeadline, actualReturnAt, now),
    [scheduleAt, toleranceDeadline, actualReturnAt, now],
  );
  const tone = rentalTimingTone(timing.state);
  const lateFee = calculateDisplayLateFee(lateFeeEnabled, lateFeePerHour, timing);
  const Icon = timing.state === "returned" ? CheckCircle2 : timing.state === "tolerance_expired" ? AlertTriangle : Clock3;

  const countdownText =
    timing.state === "before_due"
      ? formatRentalCountdown(timing.remainingMs)
      : timing.state === "in_tolerance"
        ? formatRentalCountdown(timing.remainingMs)
        : timing.state === "tolerance_expired"
          ? formatRentalCountdown(timing.overdueMs)
          : "";

  const countdownLabel =
    timing.state === "before_due"
      ? "menuju jadwal"
      : timing.state === "in_tolerance"
        ? "sisa toleransi"
        : timing.state === "tolerance_expired"
          ? "melewati toleransi"
          : "";

  if (compact) {
    return (
      <div className={"rounded-xl border px-3 py-2.5 " + toneClasses(tone) + (className ? " " + className : "")}>
        <div className="flex items-center gap-2">
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold">{rentalTimingLabel(timing.state)}</span>
              {countdownText ? <Badge variant="outline" className="rounded-full bg-background/50">{countdownText} {countdownLabel}</Badge> : null}
            </div>
            <p className="mt-0.5 text-[11px] opacity-80">Batas: {formatRentalDateTime(toleranceDeadline)}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className={(className ? className + " " : "") + "border-border/80 shadow-sm"}>
      <CardContent className="space-y-4 p-4">
        <div className={"rounded-2xl border p-4 " + toneClasses(tone)}>
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-background/70">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{rentalTimingLabel(timing.state)}</p>
                {countdownText ? <Badge variant="outline" className="rounded-full bg-background/60">{countdownText}</Badge> : null}
              </div>
              <p className="mt-1 text-xs opacity-80">
                {timing.state === "before_due"
                  ? "Menuju jadwal pengembalian."
                  : timing.state === "in_tolerance"
                    ? "Penyewaan sudah melewati jadwal tetapi masih dalam batas toleransi."
                    : timing.state === "tolerance_expired"
                      ? "Batas toleransi sudah terlewati. Segera proses pengembalian."
                      : timing.state === "returned"
                        ? "Waktu pengembalian aktual sudah tercatat."
                        : "Periksa pengembalian."}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] text-muted-foreground">Jadwal kembali</p>
            <p className="mt-1 text-sm font-semibold">{formatRentalDateTime(scheduleAt)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Batas toleransi</p>
            <p className="mt-1 text-sm font-semibold">{formatRentalDateTime(toleranceDeadline)}</p>
          </div>
          {actualReturnAt ? (
            <div className="sm:col-span-2">
              <p className="text-[11px] text-muted-foreground">Pengembalian aktual</p>
              <p className="mt-1 text-sm font-semibold">{formatRentalDateTime(actualReturnAt)}</p>
            </div>
          ) : null}
        </div>

        {lateFeeEnabled && timing.state === "tolerance_expired" ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900 dark:bg-rose-950/20">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-rose-800 dark:text-rose-200">Denda berjalan</p>
                <p className="mt-1 text-lg font-bold">{formatRentalMoney(lateFee.amount, "IDR")}</p>
              </div>
              <Badge variant="outline" className="rounded-full">{lateFee.hours} jam</Badge>
            </div>
            <p className="mt-1 text-[11px] text-rose-700/80 dark:text-rose-300/80">
              Tarif {formatRentalMoney(lateFeePerHour, "IDR")} / jam setelah toleransi. Ini belum mencatat pembayaran.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
