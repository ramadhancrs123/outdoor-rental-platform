import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CreditCard, ReceiptText, WalletCards, ChevronDown } from "lucide-react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getRentalPaymentSummary, type FinancePayment } from "@/features/keuangan";
import { formatRentalMoney } from "@/features/penyewaan";
import type { RentalDetail, RentalTenantContext } from "@/features/penyewaan";
import { paths } from "@/routes/paths";

function paymentKindLabel(value: string) {
  if (value === "dp") return "DP";
  if (value === "pelunasan") return "Pelunasan";
  return "Pembayaran Tambahan";
}

function paymentMethodLabel(value: string) {
  if (value === "cash") return "Cash";
  if (value === "bank_transfer") return "Transfer Bank";
  if (value === "qris_manual") return "QRIS Manual";
  return "Lainnya";
}

function formatPaymentDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function RentalFinanceCard({
  context,
  rental,
  onRecordPayment,
}: {
  context: RentalTenantContext;
  rental: RentalDetail;
  onRecordPayment?: () => void;
}) {
  const summary = useQuery({
    queryKey: ["keuangan", "rental-payment-summary", context.usahaId, rental.penyewaan_id, rental.total_amount],
    queryFn: () => getRentalPaymentSummary(context.usahaId, rental.penyewaan_id, Number(rental.total_amount)),
    enabled: rental.status !== "cancelled",
    staleTime: 5_000,
  });

  if (rental.status === "cancelled") return null;

  const payments = summary.data?.payments ?? [];
  const recorded = summary.data?.recordedPaymentTotal ?? 0;
  const total = Number(rental.total_amount);

  return (
    <section id="rental-finance" className="scroll-mt-24">
      <Card className="overflow-hidden rounded-[22px] border-emerald-200/70 bg-white shadow-[0_5px_24px_rgba(28,82,68,.07)] dark:border-emerald-900/40 dark:bg-card">
        <CardContent className="p-3.5 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                <WalletCards className="size-4.5" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[15px] font-bold tracking-tight text-foreground">Keuangan</p>
                  <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50/70 px-2 py-0.5 text-[9px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/25 dark:text-emerald-300">Rental</Badge>
                </div>
                <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">Pembayaran rental tetap ditelusuri melalui Keuangan.</p>
              </div>
            </div>
            <Button asChild variant="ghost" size="sm" className="h-8 shrink-0 rounded-lg px-2 text-[10px] font-semibold text-primary">
              <Link to={paths.keuangan}>Buka Keuangan<ArrowRight className="size-3.5" /></Link>
            </Button>
          </div>

          {summary.isPending ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="h-16 animate-pulse rounded-2xl bg-muted" />
              <div className="h-16 animate-pulse rounded-2xl bg-muted" />
            </div>
          ) : summary.error ? (
            <Alert variant="destructive" className="mt-3 rounded-2xl">
              <ReceiptText className="size-4" />
              <AlertTitle>Data pembayaran belum dapat dibaca</AlertTitle>
              <AlertDescription>{summary.error instanceof Error ? summary.error.message : "Silakan buka Keuangan untuk memeriksa data pembayaran."}</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2.5">
                  <p className="text-[9px] text-muted-foreground">Total rental</p>
                  <p className="mt-1 text-[14px] font-bold">{formatRentalMoney(total, rental.currency_code)}</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2.5">
                  <p className="text-[9px] text-muted-foreground">Pembayaran tercatat</p>
                  <p className="mt-1 text-[14px] font-bold">{formatRentalMoney(recorded, rental.currency_code)}</p>
                </div>
              </div>

              {payments.length ? (
                <details className="group mt-2.5 overflow-hidden rounded-2xl border border-border/60 bg-white/70 dark:bg-card/70">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[10px] font-semibold marker:hidden">
                    <span className="flex items-center gap-2"><CreditCard className="size-3.5 text-primary" />Riwayat pembayaran <span className="text-muted-foreground">({payments.length})</span></span>
                    <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-1.5 border-t border-border/60 px-3 py-2.5">
                    {payments.slice(0, 3).map((payment: FinancePayment) => (
                      <div key={payment.pembayaran_id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-semibold">{payment.nomor_pembayaran} · {paymentKindLabel(payment.jenis)}</p>
                          <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{paymentMethodLabel(payment.metode)} · {formatPaymentDate(payment.dibayar_at, context.timezone)}</p>
                        </div>
                        <p className="shrink-0 text-[10px] font-bold">{formatRentalMoney(payment.amount, payment.currency_code)}</p>
                      </div>
                    ))}
                  </div>
                </details>
              ) : (
                <p className="mt-2.5 rounded-2xl border border-dashed border-border px-3 py-3 text-center text-[10px] text-muted-foreground">
                  Belum ada pembayaran tercatat untuk penyewaan ini.
                </p>
              )}

              {onRecordPayment ? (
                <Button type="button" onClick={onRecordPayment} className="mt-2.5 h-10 w-full rounded-xl bg-[#0a6b55] text-xs font-semibold shadow-[0_8px_18px_rgba(10,107,85,.16)] hover:bg-[#075944]">
                  <CreditCard className="size-4" />
                  Catat Pembayaran
                </Button>
              ) : null}
            </>
          )}

          <p className="mt-2.5 text-[9px] leading-4 text-muted-foreground">
            Keuangan tetap menjadi sumber kebenaran fakta pembayaran; Detail Penyewaan hanya menyediakan entry point kontekstual.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
