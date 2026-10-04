import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CalendarDays, ChevronDown, CreditCard, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FinanceCorrectionDialog,
  FinanceShell,
  FinanceStatus,
  SourcePreview,
  AmountDisplay,
} from "@/components/keuangan/finance-ui";
import {
  correctPayment,
  getFinancePaymentPage,
  getFinanceReconciliationFindings,
  getKeuanganContext,
  getPayment,
  useFinancePeriod,
  formatFinanceDateTime,
  formatFinanceMoney,
  formatFinancePeriodLabel,
  semanticFinanceLabel,
  type FinanceCorrectionResult,
} from "@/features/keuangan";
import { paths } from "@/routes/paths";

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "recorded" || normalized === "valid" || normalized === "posted") return "success" as const;
  if (normalized.includes("void") || normalized.includes("reverse") || normalized === "failed") return "danger" as const;
  return "neutral" as const;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Data pembayaran gagal dimuat.";
}

function correctionKind(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toUpperCase();
  return {
    conflict: normalized.includes("BUSINESS_CONFLICT"),
    unknown: normalized.includes("UNKNOWN_OUTCOME"),
  };
}

function paymentTypeLabel(value: string) {
  if (value === "dp") return "DP";
  if (value === "pelunasan") return "Pelunasan";
  if (value === "pembayaran_tambahan") return "Pembayaran Tambahan";
  return semanticFinanceLabel(value);
}

function paymentMethodLabel(value: string) {
  if (value === "cash") return "Tunai";
  if (value === "bank_transfer") return "Transfer Bank";
  if (value === "qris_manual") return "QRIS";
  if (value === "other") return "Lainnya";
  return semanticFinanceLabel(value);
}

function paymentStatusLabel(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "recorded" || normalized === "valid" || normalized === "posted") return "Tercatat";
  if (normalized === "void" || normalized === "voided") return "Dibatalkan";
  if (normalized.includes("revers")) return "Dikoreksi";
  return semanticFinanceLabel(value);
}

function paymentDateLabel(value: string, timezone: string) {
  return formatFinanceDateTime(value, timezone);
}

export function PaymentList() {
  const queryClient = useQueryClient();
  const context = useQuery({ queryKey: ["keuangan", "context"], queryFn: getKeuanganContext, staleTime: 60_000 });
  const periodState = useFinancePeriod(context.data?.timezone ?? "Asia/Jakarta");
  const query = useQuery({
    queryKey: ["keuangan", "payments-f3", context.data?.usahaId, periodState.period],
    queryFn: () =>
      getFinancePaymentPage(
        context.data!.usahaId,
        periodState.period.startDate,
        periodState.period.endDateExclusive,
        20,
        0,
      ),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  if (context.isPending) return <FinanceShell variant="home" title="Pembayaran"><Skeleton className="h-44 rounded-[24px]" /></FinanceShell>;
  if (context.error || !context.data) return <FinanceShell variant="home" title="Pembayaran"><Alert variant="destructive"><AlertTitle>Pembayaran belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert></FinanceShell>;

  const data = query.data;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 20)));
  const currentPage = data ? Math.floor(data.offset / data.limit) + 1 : 1;

  return (
    <FinanceShell variant="home" title="Pembayaran">
      <section className="relative isolate overflow-hidden rounded-[24px] border border-white/70 shadow-[0_10px_34px_rgba(24,70,56,.10)]">
        <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/login-bg.webp')" }} />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[#075645]/76 via-[#0f5b4a]/40 to-black/18" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/28 to-transparent" />
        <div className="relative px-4 pb-4 pt-4 text-white sm:px-6 sm:pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/88 text-[#0b5d4a] shadow-sm backdrop-blur">
              <CreditCard className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/80">Keuangan</p>
              <h1 className="mt-1 text-[29px] font-bold leading-8 tracking-[-0.035em] sm:text-4xl">Pembayaran</h1>
              <p className="mt-1 max-w-xl text-[11px] leading-5 text-white/90 sm:text-sm">
                Catat dan telusuri pembayaran yang diterima untuk Reservasi atau Penyewaan.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-white/25 bg-white/12 px-2.5 py-1 text-[9px] font-semibold backdrop-blur">
              {context.data.usahaNama}
            </span>
          </div>
        </div>
      </section>

      <section className="grid gap-2 min-[380px]:grid-cols-2">
        <details className="group rounded-2xl border border-border/60 bg-card shadow-[0_3px_12px_rgba(28,67,56,.04)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3.5 marker:hidden">
            <span className="flex min-w-0 items-center gap-2">
              <CalendarDays className="size-4 text-primary" />
              <span className="min-w-0">
                <span className="block text-[9px] text-muted-foreground">Periode</span>
                <span className="mt-0.5 block truncate text-[11px] font-semibold">{data ? formatFinancePeriodLabel(data.start_date, data.end_date_exclusive, data.timezone) : "Periode dipilih"}</span>
              </span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-2 gap-1.5 border-t border-border/60 p-2">
            {([
              ["today", "Hari ini"],
              ["week", "Minggu ini"],
              ["month", "Bulan ini"],
              ["custom", "Rentang"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => periodState.setPreset(value)}
                className={"min-h-9 rounded-lg px-2 text-[9px] font-semibold " + (periodState.period.preset === value ? "bg-primary text-primary-foreground" : "bg-muted/35 text-muted-foreground")}
              >
                {label}
              </button>
            ))}
            {periodState.period.preset === "custom" ? (
              <div className="col-span-2 grid grid-cols-2 gap-2 pt-1">
                <Input aria-label="Tanggal mulai" type="date" value={periodState.period.startDate} onChange={(event) => { periodState.setCustomStart(event.target.value); periodState.setPreset("custom"); }} className="h-9 rounded-lg text-[10px]" />
                <Input aria-label="Tanggal selesai" type="date" value={periodState.period.endDateExclusive.slice(0, 10)} onChange={(event) => { periodState.setCustomEnd(event.target.value); periodState.setPreset("custom"); }} className="h-9 rounded-lg text-[10px]" />
              </div>
            ) : null}
          </div>
        </details>

        <details className="group rounded-2xl border border-border/60 bg-card shadow-[0_3px_12px_rgba(28,67,56,.04)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3.5 marker:hidden">
            <span className="flex min-w-0 items-center gap-2">
              <CreditCard className="size-4 text-primary" />
              <span className="min-w-0">
                <span className="block text-[9px] text-muted-foreground">Ringkasan</span>
                <span className="mt-0.5 block truncate text-[11px] font-semibold">{data?.total ?? 0} pembayaran</span>
              </span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border/60 px-3.5 py-3 text-[10px] leading-4 text-muted-foreground">
            Pembayaran dicatat sebagai fakta uang dan dapat ditelusuri ke Reservasi atau Penyewaan.
          </div>
        </details>
      </section>

      <section className="rounded-[22px] border border-border/60 bg-card p-2.5 shadow-[0_4px_16px_rgba(30,68,57,.05)]">
        <Button asChild className="h-12 w-full rounded-xl bg-[#0a6b55] text-xs font-semibold shadow-[0_8px_18px_rgba(10,107,85,.14)] hover:bg-[#075944]">
          <Link to={paths.keuangan + "/pembayaran/create"}><Plus className="size-4.5" />Catat Pembayaran</Link>
        </Button>
      </section>

      {query.isPending ? (
        <section className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-[20px]" />)}
        </section>
      ) : query.error ? (
        <Alert variant="destructive"><AlertTitle>Daftar pembayaran belum tersedia</AlertTitle><AlertDescription className="space-y-3"><p>{errorMessage(query.error)}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription></Alert>
      ) : data && data.items.length === 0 ? (
        <section className="rounded-[22px] border border-dashed bg-card p-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">
            <CreditCard className="size-6" />
          </span>
          <h2 className="mt-4 text-[16px] font-bold">Belum ada pembayaran</h2>
          <p className="mx-auto mt-1 max-w-sm text-[10px] leading-5 text-muted-foreground">
            Belum ada pembayaran tercatat pada periode yang dipilih.
          </p>
          <Button asChild className="mt-4 rounded-xl"><Link to={paths.keuangan + "/pembayaran/create"}>Catat Pembayaran</Link></Button>
        </section>
      ) : data ? (
        <>
          <section className="rounded-[22px] border border-border/60 bg-card p-3.5 shadow-[0_4px_16px_rgba(30,68,57,.04)]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300">
                  <CreditCard className="size-4.5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold">Pembayaran Tercatat</h2>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{data.total} pembayaran pada periode ini.</p>
                </div>
              </div>
              <span className="rounded-full bg-muted/50 px-2.5 py-1 text-[9px] font-semibold text-muted-foreground">
                {formatFinancePeriodLabel(data.start_date, data.end_date_exclusive, data.timezone)}
              </span>
            </div>
          </section>
          <div className="grid gap-2.5 md:hidden">
            {data.items.map((item) => (
              <Link key={item.pembayaran_id} to={paths.keuangan + "/pembayaran/" + item.pembayaran_id} className="block">
                <article className="rounded-[18px] border border-border/60 bg-background px-3 py-3 transition-colors hover:bg-muted/20">
                  <div className="flex items-start gap-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300">
                      <CreditCard className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-semibold">{item.source_label ?? "Sumber belum ditautkan"}</p>
                          <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{item.nomor_pembayaran}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{formatFinanceMoney(item.amount, item.currency_code)}</p>
                          <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[8px] font-semibold text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300">{paymentStatusLabel(item.status)}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
                        <span>{paymentTypeLabel(item.jenis)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{paymentMethodLabel(item.metode)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{paymentDateLabel(item.dibayar_at, data.timezone)}</span>
                      </div>
                      {item.reference_text ? (
                        <p className="mt-1.5 truncate text-[8px] text-muted-foreground">Referensi: {item.reference_text}</p>
                      ) : null}
                      <div className="mt-2 flex items-center justify-end gap-1 text-[9px] font-semibold text-primary">
                        Lihat detail <ArrowRight className="size-3.5" />
                      </div>
                    </div>
                  </div>
                </article>
              </Link>
            ))}
          </div>
          <Card className="hidden overflow-hidden shadow-sm md:block">
            <CardHeader className="border-b bg-muted/20"><CardTitle className="text-base">Daftar Pembayaran</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/25 text-left"><tr><th className="px-5 py-3 font-medium">Pembayaran</th><th className="px-5 py-3 font-medium">Sumber</th><th className="px-5 py-3 font-medium">Nominal</th><th className="px-5 py-3 font-medium">Metode</th><th className="px-5 py-3 font-medium">Status</th></tr></thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.pembayaran_id} className="border-b last:border-0">
                        <td className="px-5 py-4"><Link to={paths.keuangan + "/pembayaran/" + item.pembayaran_id} className="font-semibold hover:text-primary hover:underline"><span className="block">{item.nomor_pembayaran}</span><span className="mt-0.5 block text-xs font-normal text-muted-foreground">{paymentDateLabel(item.dibayar_at, data.timezone)}</span></Link></td>
                        <td className="px-5 py-4">{item.source_label ?? "Sumber belum ditautkan"}</td>
                        <td className="px-5 py-4 font-semibold tabular-nums">{formatFinanceMoney(item.amount, item.currency_code)}</td>
                        <td className="px-5 py-4">{paymentMethodLabel(item.metode)}</td>
                        <td className="px-5 py-4"><FinanceStatus status={paymentStatusLabel(item.status)} tone={statusTone(item.status)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
            <span className="text-muted-foreground">Halaman {currentPage} dari {totalPages}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={currentPage <= 1}
                onClick={async () => {
                  if (!context.data || !data) return;
                  const previous = await getFinancePaymentPage(
                    context.data.usahaId,
                    data.start_date,
                    data.end_date_exclusive,
                    data.limit,
                    Math.max(0, data.offset - data.limit),
                  );
                  queryClient.setQueryData(["keuangan", "payments-f3", context.data.usahaId, periodState.period], previous);
                }}
              >Sebelumnya</Button>
              <Button
                variant="outline"
                disabled={currentPage >= totalPages}
                onClick={async () => {
                  if (!context.data || !data) return;
                  const next = await getFinancePaymentPage(
                    context.data.usahaId,
                    data.start_date,
                    data.end_date_exclusive,
                    data.limit,
                    data.offset + data.limit,
                  );
                  queryClient.setQueryData(["keuangan", "payments-f3", context.data.usahaId, periodState.period], next);
                }}
              >Berikutnya</Button>
            </div>
          </div>
        </>
      ) : null}
    </FinanceShell>
  );
}

export function PaymentShow() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const context = useQuery({ queryKey: ["keuangan", "context"], queryFn: getKeuanganContext, staleTime: 60_000 });
  const query = useQuery({
    queryKey: ["keuangan", "payment", context.data?.usahaId, id],
    queryFn: () => getPayment(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
  });

  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionResult, setCorrectionResult] = useState<FinanceCorrectionResult | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [businessConflict, setBusinessConflict] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);

  const findings = useQuery({
    queryKey: ["keuangan", "correction-findings", context.data?.usahaId, id],
    queryFn: () => getFinanceReconciliationFindings(context.data!.usahaId, 20),
    enabled: false,
  });

  const correction = useMutation({
    mutationFn: ({ action, reason }: { action: "void" | "reversal"; reason: string }) =>
      correctPayment(context.data!.usahaId, id!, action, reason, {
        idempotencyKey: createClientId(),
        requestId: createClientId(),
      }),
    onMutate: () => {
      setCorrectionError(null);
      setBusinessConflict(false);
      setUnknownOutcome(false);
    },
    onSuccess: async (result) => {
      setCorrectionResult(result);
      await queryClient.invalidateQueries({ queryKey: ["keuangan"] });
    },
    onError: async (error) => {
      const kind = correctionKind(error);
      if (kind.unknown) {
        await findings.refetch();
      }
      setBusinessConflict(kind.conflict);
      setUnknownOutcome(kind.unknown);
      setCorrectionError(errorMessage(error));
    },
  });

  if (context.isPending || query.isPending) return <FinanceShell title="Detail Pembayaran"><Skeleton className="h-[650px] rounded-2xl" /></FinanceShell>;
  if (context.error || query.error || !query.data) return <FinanceShell title="Detail Pembayaran"><Alert variant="destructive"><AlertTitle>Detail pembayaran tidak tersedia</AlertTitle><AlertDescription>{errorMessage(context.error ?? query.error)}</AlertDescription></Alert></FinanceShell>;

  const item = query.data;
  const alreadyCorrected = /void|revers/i.test(item.status);
  return (
    <FinanceShell
      title="Detail Pembayaran"
      subtitle={item.nomor_transaksi ? "Transaksi Keuangan " + item.nomor_transaksi : "Detail Pembayaran"}
      action={<div className="flex items-center gap-2"><Button asChild variant="ghost" className="rounded-xl"><Link to={paths.keuangan + "/pembayaran"}><ArrowLeft />Kembali</Link></Button>{!alreadyCorrected ? <Button variant="outline" className="rounded-xl" onClick={() => { setCorrectionResult(null); setCorrectionError(null); setCorrectionOpen(true); }}>Koreksi</Button> : null}</div>}
    >
      <section className="relative overflow-hidden rounded-[28px] border bg-card p-5 shadow-sm sm:p-7">
        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{item.nomor_pembayaran}</p>
            <FinanceStatus status={semanticFinanceLabel(item.status)} tone={statusTone(item.status)} />
          </div>
          <div className="mt-4"><AmountDisplay amount={item.amount} direction="income" /><p className="mt-2 text-sm text-muted-foreground">{semanticFinanceLabel(item.jenis)} · {semanticFinanceLabel(item.metode)} · {formatFinanceDateTime(item.dibayar_at, context.data.timezone)}</p></div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <div className="space-y-5">
          {item.reservasi_id || item.penyewaan_id ? (
            <SourcePreview type={item.reservasi_id ? "Reservasi" : "Penyewaan"} number={item.source_label?.replace(/^(Reservasi|Penyewaan) /, "") ?? "Source"} meta="Source payment" />
          ) : null}
          <Card><CardHeader><CardTitle className="text-base">Detail Pembayaran</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
            <Info label="Jenis Pembayaran" value={semanticFinanceLabel(item.jenis)} />
            <Info label="Metode" value={semanticFinanceLabel(item.metode)} />
            <Info label="Nominal" value={formatFinanceMoney(item.amount, item.currency_code)} />
            <Info label="Waktu Pembayaran" value={formatFinanceDateTime(item.dibayar_at, context.data.timezone)} />
            <Info label="Reference" value={item.reference_text ?? "-"} />
            <Info label="Catatan" value={item.catatan ?? "-"} />
          </CardContent></Card>
        </div>
        <Card><CardHeader><CardTitle className="text-base">Transaksi Keuangan</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="rounded-2xl border bg-emerald-50/50 p-4 dark:bg-emerald-950/15"><p className="text-xs text-muted-foreground">{item.nomor_transaksi ?? "TRX"}</p><p className="mt-1 text-lg font-bold">Pemasukan</p><p className="mt-1 text-sm">{semanticFinanceLabel(item.status)}</p></div>
          <Info label="Transaksi Keuangan" value={item.nomor_transaksi ?? "-"} />
          <Info label="Pembayaran" value={item.nomor_pembayaran} />
          <p className="text-xs leading-5 text-muted-foreground">Pembayaran dan Transaksi Keuangan ditampilkan terpisah agar pencatatan tetap jelas.</p>
        </CardContent></Card>
      </div>

      <Card><CardContent className="space-y-3 p-5"><p className="text-sm font-semibold">Correction boundary</p><p className="text-xs leading-5 text-muted-foreground">Void/Reversal mempertahankan histori. Amount, source, dan tanggal tidak diedit langsung.</p></CardContent></Card>

      <FinanceCorrectionDialog
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        title="Koreksi Pembayaran"
        amount={formatFinanceMoney(item.amount, item.currency_code)}
        onSubmit={(action, reason) => correction.mutate({ action, reason })}
        busy={correction.isPending}
        result={correctionResult}
        error={correctionError}
        businessConflict={businessConflict}
        unknownOutcome={unknownOutcome}
      />
    </FinanceShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p></div>;
}
