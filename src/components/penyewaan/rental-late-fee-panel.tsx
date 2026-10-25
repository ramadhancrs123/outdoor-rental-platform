import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Calculator, CheckCircle2, ChevronDown, Clock3, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { RentalConsequenceReview } from "@/features/keuangan";
import { calculateDisplayLateFee, deriveRentalTiming, rentalTimingLabel } from "@/features/penyewaan/timing";
import { formatRentalDateTime, formatRentalMoney } from "@/features/penyewaan/utils";

type Props = {
  scheduleAt: string;
  toleranceDeadline: string | null;
  actualReturnAt?: string | null;
  rentalStatus: string;
  lateFeeEnabled: boolean;
  lateFeePerHour: number;
  currencyCode: string;
  reviews: RentalConsequenceReview[];
  reviewsPending?: boolean;
  reviewsError?: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

function reviewStatus(status: RentalConsequenceReview["status"]) {
  if (status === "approved") return "Disetujui Finance";
  if (status === "rejected") return "Tidak dibebankan";
  return "Menunggu tinjauan";
}

function reviewAmount(review: RentalConsequenceReview) {
  return review.nominal_disetujui ?? review.nominal_kandidat;
}

export function RentalLateFeePanel({
  scheduleAt,
  toleranceDeadline,
  actualReturnAt = null,
  rentalStatus,
  lateFeeEnabled,
  lateFeePerHour,
  currencyCode,
  reviews,
  reviewsPending = false,
  reviewsError = false,
  expanded,
  onExpandedChange,
}: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const timing = useMemo(
    () => deriveRentalTiming(scheduleAt, toleranceDeadline, actualReturnAt, now),
    [scheduleAt, toleranceDeadline, actualReturnAt, now],
  );
  const validRate = Number.isFinite(lateFeePerHour) && lateFeePerHour > 0;
  const canEstimate = lateFeeEnabled && validRate;
  const feeFlowEligible = rentalStatus === "active"
    || rentalStatus === "return_in_progress"
    || (rentalStatus === "completed" && Boolean(actualReturnAt));
  const billingHasStarted = feeFlowEligible && (timing.state === "due" || timing.state === "tolerance_expired" || timing.state === "returned");
  const estimate = canEstimate && billingHasStarted
    ? calculateDisplayLateFee(true, lateFeePerHour, timing)
    : { hours: 0, amount: 0 };
  const cutoff = toleranceDeadline ?? scheduleAt;
  const estimateLabel = !feeFlowEligible
    ? "Belum berlaku"
    : !lateFeeEnabled
      ? "Tidak aktif"
      : !validRate
        ? "Tarif belum diatur"
        : timing.state === "returned"
          ? "Denda saat pengembalian"
          : billingHasStarted
            ? "Estimasi denda berjalan"
            : "Denda saat ini";

  return (
    <section id="rental-late-fee" className="scroll-mt-24" data-testid="rental-late-fee-panel">
      <Card className="overflow-hidden rounded-[22px] border-amber-200/70 bg-card shadow-[0_5px_22px_rgba(110,77,18,.06)] dark:border-amber-900/40">
        <details
          className="group"
          open={expanded}
          onToggle={(event) => onExpandedChange(event.currentTarget.open)}
        >
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 marker:hidden sm:px-4">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300">
                <Calculator className="size-4.5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[14px] font-bold tracking-tight">Perhitungan Denda</h2>
                  <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50/60 px-2 py-0.5 text-[9px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-200">
                    {rentalTimingLabel(timing.state)}
                  </Badge>
                </span>
                {!expanded ? (
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {!lateFeeEnabled ? "Denda nonaktif" : !validRate ? "Tarif belum diatur" : !feeFlowEligible ? "Belum berlaku" : formatRentalMoney(estimate.amount, currencyCode)}
                  </span>
                ) : null}
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>

          {expanded ? (
            <CardContent className="space-y-3 border-t border-border/60 px-3.5 py-3 sm:px-4">
              <div className="rounded-2xl border border-border/60 bg-muted/15 p-3">
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium text-muted-foreground">{estimateLabel}</p>
                    <p className="mt-1 break-words text-[22px] font-bold leading-7 tracking-tight tabular-nums">
                      {!lateFeeEnabled ? "Tidak aktif" : !validRate ? "Belum diatur" : !feeFlowEligible ? "Belum berlaku" : formatRentalMoney(estimate.amount, currencyCode)}
                    </p>
                  </div>
                  <span className={"mb-0.5 grid size-8 shrink-0 place-items-center rounded-xl " + (
                    !lateFeeEnabled || !validRate
                      ? "bg-muted text-muted-foreground"
                      : estimate.hours > 0
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  )}>
                    {!lateFeeEnabled || !validRate ? <ShieldCheck className="size-4" /> : estimate.hours > 0 ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
                  </span>
                </div>

                {canEstimate ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-border/55 bg-background/70 px-2.5 py-2">
                      <p className="text-[9px] text-muted-foreground">Tarif per jam</p>
                      <p className="mt-0.5 break-words text-[12px] font-semibold">{formatRentalMoney(lateFeePerHour, currencyCode)}</p>
                    </div>
                    <div className="rounded-xl border border-border/55 bg-background/70 px-2.5 py-2">
                      <p className="text-[9px] text-muted-foreground">Jam terlambat</p>
                      <p className="mt-0.5 text-[12px] font-semibold">{estimate.hours} jam</p>
                    </div>
                  </div>
                ) : null}
              </div>

              {lateFeeEnabled && validRate && feeFlowEligible ? (
                <div className="grid grid-cols-1 gap-2 rounded-xl border border-border/60 px-3 py-2.5 sm:grid-cols-2">
                  <div className="min-w-0">
                    <p className="text-[9px] text-muted-foreground">Mulai perhitungan</p>
                    <p className="mt-0.5 text-[11px] font-semibold">{formatRentalDateTime(cutoff)}</p>
                    <p className="mt-0.5 text-[9px] text-muted-foreground">{toleranceDeadline ? "Termasuk toleransi" : "Tanpa toleransi"}</p>
                  </div>
                  <div className="min-w-0 sm:border-l sm:border-border/60 sm:pl-3">
                    <p className="text-[9px] text-muted-foreground">Metode</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold"><Clock3 className="size-3.5" />Pembulatan per jam</p>
                  </div>
                </div>
              ) : null}

              <div className="border-t border-border/60 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold">Tinjauan Finance</p>
                  {reviews.length ? <Badge variant="secondary" className="rounded-full text-[9px]">{reviews.length} catatan</Badge> : null}
                </div>
                {reviewsPending ? (
                  <p className="mt-2 text-[10px] text-muted-foreground">Memuat tinjauan…</p>
                ) : reviewsError ? (
                  <p className="mt-2 text-[10px] text-amber-800 dark:text-amber-200">Tinjauan tidak tersedia.</p>
                ) : reviews.length ? (
                  <div className="mt-2 space-y-1.5">
                    {reviews.slice(0, 3).map((review) => (
                      <div key={review.evaluasi_konsekuensi_id} className="flex items-start justify-between gap-2 rounded-xl border border-border/60 bg-muted/10 px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold">{reviewStatus(review.status)}</p>
                          <p className="mt-0.5 line-clamp-2 text-[9px] leading-4 text-muted-foreground">{review.alasan || "—"}</p>
                          <p className="mt-0.5 text-[9px] text-muted-foreground">{formatRentalDateTime(review.updated_at)}</p>
                        </div>
                        <p className="shrink-0 text-right text-[10px] font-bold">
                          {review.status === "rejected"
                            ? formatRentalMoney(0, review.currency_code)
                            : reviewAmount(review) == null
                              ? "—"
                              : formatRentalMoney(reviewAmount(review), review.currency_code)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] text-muted-foreground">Belum ada tinjauan denda.</p>
                )}
              </div>
            </CardContent>
          ) : null}
        </details>
      </Card>
    </section>
  );
}
