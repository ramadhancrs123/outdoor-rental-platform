import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CreditCard, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FinanceCorrectionDialog,
  FinancePeriodBar,
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
  formatFinanceTimezone,
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

  if (context.isPending) return <FinanceShell title="Pembayaran"><Skeleton className="h-96 rounded-2xl" /></FinanceShell>;
  if (context.error || !context.data) return <FinanceShell title="Pembayaran"><Alert variant="destructive"><AlertTitle>Pembayaran belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert></FinanceShell>;

  const data = query.data;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 20)));
  const currentPage = data ? Math.floor(data.offset / data.limit) + 1 : 1;

  return (
    <FinanceShell
      title="Pembayaran"
      subtitle="Payment facts berasal dari server. Payment tidak mengubah status Reservation atau Rental secara otomatis."
      action={<Button asChild className="rounded-xl"><Link to={paths.keuangan + "/pembayaran/create"}><Plus />Catat Pembayaran</Link></Button>}
    >
      <FinancePeriodBar
        timezone={formatFinanceTimezone(context.data.timezone)}
        selection={periodState.period}
        onPreset={periodState.setPreset}
        onCustomStart={(value) => { periodState.setCustomStart(value); periodState.setPreset("custom"); }}
        onCustomEnd={(value) => { periodState.setCustomEnd(value); periodState.setPreset("custom"); }}
        serverPeriod={data ? { startDate: data.start_date, endDateExclusive: data.end_date_exclusive, timezone: data.timezone } : null}
      />

      {query.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
      ) : query.error ? (
        <Alert variant="destructive"><AlertTitle>Daftar pembayaran belum tersedia</AlertTitle><AlertDescription className="space-y-3"><p>{errorMessage(query.error)}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription></Alert>
      ) : data && data.items.length === 0 ? (
        <Card><CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center"><CreditCard className="size-9 text-muted-foreground" /><h2 className="text-lg font-semibold">Belum ada pembayaran pada periode ini</h2><p className="max-w-md text-sm text-muted-foreground">Periode di atas mengikuti business date pada timezone Usaha.</p><Button asChild variant="outline" className="rounded-xl"><Link to={paths.keuangan + "/pembayaran/create"}>Catat Pembayaran</Link></Button></CardContent></Card>
      ) : data ? (
        <>
          <div className="rounded-2xl border bg-card p-3 text-xs text-muted-foreground shadow-sm">
            Periode server: <span className="font-semibold text-foreground">{formatFinancePeriodLabel(data.start_date, data.end_date_exclusive, data.timezone)}</span> · {data.total} payment
          </div>
          <div className="grid gap-3 md:hidden">
            {data.items.map((item) => (
              <Link key={item.pembayaran_id} to={paths.keuangan + "/pembayaran/" + item.pembayaran_id}>
                <Card className="transition-colors hover:bg-accent/40">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{item.nomor_pembayaran}</p>
                        <p className="mt-1 text-sm font-semibold">{item.source_label ?? "Sumber tidak ditautkan"}</p>
                      </div>
                      <FinanceStatus status={semanticFinanceLabel(item.status)} tone={statusTone(item.status)} />
                    </div>
                    <AmountDisplay amount={item.amount} direction="income" compact />
                    <p className="text-xs text-muted-foreground">{semanticFinanceLabel(item.jenis)} · {semanticFinanceLabel(item.metode)} · {formatFinanceDateTime(item.dibayar_at, data.timezone)}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <Card className="hidden overflow-hidden shadow-sm md:block">
            <CardHeader className="border-b bg-muted/20"><CardTitle className="text-base">Daftar Pembayaran</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30 text-left"><tr><th className="px-5 py-3 font-medium">Date</th><th className="px-5 py-3 font-medium">Source</th><th className="px-5 py-3 font-medium">Amount</th><th className="px-5 py-3 font-medium">Method</th><th className="px-5 py-3 font-medium">Status</th></tr></thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.pembayaran_id} className="border-b last:border-0">
                        <td className="px-5 py-4"><Link to={paths.keuangan + "/pembayaran/" + item.pembayaran_id} className="font-semibold hover:text-primary hover:underline">{formatFinanceDateTime(item.dibayar_at, data.timezone)}</Link></td>
                        <td className="px-5 py-4">{item.source_label ?? "Sumber tidak ditautkan"}</td>
                        <td className="px-5 py-4 font-semibold tabular-nums">{formatFinanceMoney(item.amount, item.currency_code)}</td>
                        <td className="px-5 py-4">{semanticFinanceLabel(item.metode)}</td>
                        <td className="px-5 py-4"><FinanceStatus status={semanticFinanceLabel(item.status)} tone={statusTone(item.status)} /></td>
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
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
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
      subtitle={item.nomor_transaksi ? "Financial transaction " + item.nomor_transaksi : "Payment detail"}
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
          <Info label="Financial Transaction" value={item.nomor_transaksi ?? "-"} />
          <Info label="Payment" value={item.nomor_pembayaran} />
          <p className="text-xs leading-5 text-muted-foreground">Payment adalah konteks pembayaran. Financial Transaction adalah fakta finansial sumber. Keduanya sengaja ditampilkan terpisah.</p>
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
