import { createClientId } from "@/lib/client-id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CalendarDays, ChevronDown, Plus, ReceiptText, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AmountDisplay,
  FinanceCorrectionDialog,
  FinanceShell,
  SourcePreview,
} from "@/components/keuangan/finance-ui";
import {
  correctExpense,
  getExpense,
  getFinanceExpensePage,
  getFinanceReconciliationFindings,
  getKeuanganContext,
  useFinancePeriod,
  formatFinanceDate,
  formatFinanceMoney,
  formatFinancePeriodLabel,
  semanticFinanceLabel,
  type FinanceCorrectionResult,
} from "@/features/keuangan";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Data pengeluaran gagal dimuat.";
}

function correctionKind(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toUpperCase();
  return {
    conflict: normalized.includes("BUSINESS_CONFLICT"),
    unknown: normalized.includes("UNKNOWN_OUTCOME"),
  };
}

function expenseSourceLabel(sourceType: string | null, category: string) {
  if (sourceType === "purchase") return "Pembelian";
  if (sourceType === "maintenance") return "Perawatan";
  if (sourceType === "supplier") return "Pemasok";
  if (sourceType === "operasional") return "Operasional";
  return semanticFinanceLabel(category);
}

export function ExpenseList() {
  const queryClient = useQueryClient();
  const context = useQuery({ queryKey: ["keuangan", "context"], queryFn: getKeuanganContext, staleTime: 60_000 });
  const periodState = useFinancePeriod(context.data?.timezone ?? "Asia/Jakarta");
  const query = useQuery({
    queryKey: ["keuangan", "expenses-f3", context.data?.usahaId, periodState.period],
    queryFn: () =>
      getFinanceExpensePage(context.data!.usahaId, periodState.period.startDate, periodState.period.endDateExclusive, 20, 0),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  if (context.isPending) {
    return (
      <FinanceShell variant="home" title="Pengeluaran">
        <Skeleton className="h-44 rounded-[24px]" />
      </FinanceShell>
    );
  }

  if (context.error || !context.data) {
    return (
      <FinanceShell variant="home" title="Pengeluaran">
        <Alert variant="destructive">
          <AlertTitle>Pengeluaran belum dapat dibuka</AlertTitle>
          <AlertDescription>{errorMessage(context.error)}</AlertDescription>
        </Alert>
      </FinanceShell>
    );
  }

  const data = query.data;
  const currentPage = data ? Math.floor(data.offset / data.limit) + 1 : 1;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 20)));
  const currentPeriodLabel = data ? formatFinancePeriodLabel(data.start_date, data.end_date_exclusive, data.timezone) : "Periode dipilih";

  const changePage = async (page: number) => {
    if (!data || !context.data) return;
    const next = await getFinanceExpensePage(
      context.data.usahaId,
      data.start_date,
      data.end_date_exclusive,
      data.limit,
      (page - 1) * data.limit,
    );
    queryClient.setQueryData(["keuangan", "expenses-f3", context.data.usahaId, periodState.period], next);
  };

  return (
    <FinanceShell variant="home" title="Pengeluaran">
      <section className="relative isolate overflow-hidden rounded-[24px] border border-white/70 shadow-[0_10px_34px_rgba(24,70,56,.10)]">
        <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/login-bg.webp')" }} />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[#075645]/76 via-[#0f5b4a]/40 to-black/18" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/28 to-transparent" />
        <div className="relative px-4 pb-4 pt-4 text-white sm:px-6 sm:pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/88 text-[#0b5d4a] shadow-sm backdrop-blur">
              <ReceiptText className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/80">Keuangan</p>
              <h1 className="mt-1 text-[29px] font-bold leading-8 tracking-[-0.035em] sm:text-4xl">Pengeluaran</h1>
              <p className="mt-1 max-w-xl text-[11px] leading-5 text-white/90 sm:text-sm">Catat dan telusuri biaya operasional usaha.</p>
            </div>
            <span className="shrink-0 rounded-full border border-white/25 bg-white/12 px-2.5 py-1 text-[9px] font-semibold backdrop-blur">{context.data.usahaNama}</span>
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
                <span className="mt-0.5 block truncate text-[11px] font-semibold">{currentPeriodLabel}</span>
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
                <input aria-label="Tanggal mulai" type="date" value={periodState.period.startDate} onChange={(event) => { periodState.setCustomStart(event.target.value); periodState.setPreset("custom"); }} className="h-9 min-w-0 rounded-lg border bg-card px-2 text-[10px]" />
                <input aria-label="Tanggal selesai" type="date" value={periodState.period.endDateExclusive.slice(0, 10)} onChange={(event) => { periodState.setCustomEnd(event.target.value); periodState.setPreset("custom"); }} className="h-9 min-w-0 rounded-lg border bg-card px-2 text-[10px]" />
              </div>
            ) : null}
          </div>
        </details>

        <details className="group rounded-2xl border border-border/60 bg-card shadow-[0_3px_12px_rgba(28,67,56,.04)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3.5 marker:hidden">
            <span className="flex min-w-0 items-center gap-2">
              <ReceiptText className="size-4 text-primary" />
              <span className="min-w-0">
                <span className="block text-[9px] text-muted-foreground">Ringkasan</span>
                <span className="mt-0.5 block truncate text-[11px] font-semibold">{data?.total ?? 0} pengeluaran</span>
              </span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border/60 px-3.5 py-3 text-[10px] leading-4 text-muted-foreground">Pengeluaran adalah rincian biaya operasional yang dapat ditelusuri ke Transaksi Keuangan.</div>
        </details>
      </section>

      <section className="rounded-[22px] border border-border/60 bg-card p-2.5 shadow-[0_4px_16px_rgba(30,68,57,.05)]">
        <Button asChild className="h-12 w-full rounded-xl bg-[#0a6b55] text-xs font-semibold shadow-[0_8px_18px_rgba(10,107,85,.14)] hover:bg-[#075944]">
          <Link to={paths.keuangan + "/pengeluaran/create"}><Plus className="size-4.5" />Catat Pengeluaran</Link>
        </Button>
      </section>

      {query.isPending ? (
        <section className="space-y-2.5">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-[20px]" />)}</section>
      ) : query.error ? (
        <Alert variant="destructive">
          <AlertTitle>Daftar pengeluaran belum tersedia</AlertTitle>
          <AlertDescription className="space-y-3"><p>{errorMessage(query.error)}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription>
        </Alert>
      ) : data && data.items.length === 0 ? (
        <section className="rounded-[22px] border border-dashed bg-card p-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-300"><ReceiptText className="size-6" /></span>
          <h2 className="mt-4 text-[16px] font-bold">Belum ada pengeluaran</h2>
          <p className="mx-auto mt-1 max-w-sm text-[10px] leading-5 text-muted-foreground">Belum ada pengeluaran tercatat pada periode yang dipilih.</p>
          <Button asChild className="mt-4 rounded-xl"><Link to={paths.keuangan + "/pengeluaran/create"}>Catat Pengeluaran</Link></Button>
        </section>
      ) : data ? (
        <>
          <section className="rounded-[22px] border border-border/60 bg-card p-3.5 shadow-[0_4px_16px_rgba(30,68,57,.04)]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/25 dark:text-rose-300"><ReceiptText className="size-4.5" /></span>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold">Pengeluaran Tercatat</h2>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{data.total} pengeluaran pada periode ini.</p>
                </div>
              </div>
              <span className="rounded-full bg-muted/50 px-2.5 py-1 text-[9px] font-semibold text-muted-foreground">{currentPeriodLabel}</span>
            </div>
          </section>

          <div className="grid min-w-0 gap-2.5 md:hidden">
            {data.items.map((item) => (
              <Link key={item.pengeluaran_id} to={paths.keuangan + "/pengeluaran/" + item.pengeluaran_id} className="block min-w-0">
                <article className="min-w-0 overflow-hidden rounded-[18px] border border-border/60 bg-background px-3 py-3 transition-colors hover:bg-muted/20">
                  <div className="flex items-start gap-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/25 dark:text-rose-300"><ReceiptText className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-semibold">{item.deskripsi}</p>
                          <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                            {expenseSourceLabel(item.source_type, item.kategori_biaya)}{item.pemasok_nama ? " · " + item.pemasok_nama : ""}
                          </p>
                        </div>
                        <p className="shrink-0 text-[13px] font-bold tabular-nums text-rose-700 dark:text-rose-300">{formatFinanceMoney(item.amount, item.currency_code)}</p>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
                        <span>Tercatat</span><span aria-hidden="true">·</span><span>{formatFinanceDate(item.tanggal_pengeluaran, data.timezone)}</span><span aria-hidden="true">·</span><span>{item.nomor_transaksi ?? "Tanpa nomor transaksi"}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-end gap-1 text-[9px] font-semibold text-primary">Lihat detail <ArrowRight className="size-3.5" /></div>
                    </div>
                  </div>
                </article>
              </Link>
            ))}
          </div>

          <section className="hidden overflow-hidden rounded-[22px] border border-border/60 bg-card shadow-[0_4px_16px_rgba(30,68,57,.04)] md:block">
            <div className="border-b border-border/60 px-4 py-3.5">
              <h2 className="text-[15px] font-bold">Daftar Pengeluaran</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{data.total} pengeluaran · {currentPeriodLabel}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/25 text-left">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold">Pengeluaran</th>
                    <th className="px-4 py-3 text-xs font-semibold">Sumber</th>
                    <th className="px-4 py-3 text-xs font-semibold">Pemasok</th>
                    <th className="px-4 py-3 text-xs font-semibold">Nominal</th>
                    <th className="px-4 py-3 text-xs font-semibold">Transaksi Keuangan</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.pengeluaran_id} className="border-b last:border-0">
                      <td className="px-4 py-3.5">
                        <Link to={paths.keuangan + "/pengeluaran/" + item.pengeluaran_id} className="font-semibold hover:text-primary hover:underline">
                          <span className="block">{item.deskripsi}</span>
                          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{formatFinanceDate(item.tanggal_pengeluaran, data.timezone)}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">{expenseSourceLabel(item.source_type, item.kategori_biaya)}</td>
                      <td className="px-4 py-3.5">{item.pemasok_nama ?? "Tidak ditautkan"}</td>
                      <td className="px-4 py-3.5 font-semibold tabular-nums">{formatFinanceMoney(item.amount, item.currency_code)}</td>
                      <td className="px-4 py-3.5">{item.nomor_transaksi ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-3.5 py-3 text-[10px]">
            <span className="text-muted-foreground">Halaman {currentPage} dari {totalPages}</span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={currentPage <= 1} className="h-9 rounded-xl px-3 text-[10px]" onClick={() => void changePage(currentPage - 1)}>Sebelumnya</Button>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages} className="h-9 rounded-xl px-3 text-[10px]" onClick={() => void changePage(currentPage + 1)}>Berikutnya</Button>
            </div>
          </div>
        </>
      ) : null}

      <div className="flex items-center justify-center px-2 pb-2 text-[9px] text-muted-foreground">Periode: {currentPeriodLabel} · Data pengeluaran tersimpan sesuai Usaha aktif.</div>
    </FinanceShell>
  );
}


export function ExpenseShow() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const context = useQuery({ queryKey: ["keuangan", "context"], queryFn: getKeuanganContext, staleTime: 60_000 });
  const query = useQuery({
    queryKey: ["keuangan", "expense", context.data?.usahaId, id],
    queryFn: () => getExpense(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
  });

  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionResult, setCorrectionResult] = useState<FinanceCorrectionResult | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [businessConflict, setBusinessConflict] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);

  const findings = useQuery({
    queryKey: ["keuangan", "expense-correction-findings", context.data?.usahaId, id],
    queryFn: () => getFinanceReconciliationFindings(context.data!.usahaId, 20),
    enabled: false,
  });

  const correction = useMutation({
    mutationFn: ({ action, reason }: { action: "void" | "reversal"; reason: string }) =>
      correctExpense(context.data!.usahaId, id!, action, reason, {
        idempotencyKey: createClientId(),
        requestId: createClientId(),
      }),
    onSuccess: async (result) => {
      setCorrectionResult(result);
      await queryClient.invalidateQueries({ queryKey: ["keuangan"] });
    },
    onError: async (error) => {
      const kind = correctionKind(error);
      if (kind.unknown) await findings.refetch();
      setBusinessConflict(kind.conflict);
      setUnknownOutcome(kind.unknown);
      setCorrectionError(errorMessage(error));
    },
  });

  if (context.isPending || query.isPending) return <FinanceShell title="Detail Pengeluaran"><Skeleton className="h-[650px] rounded-2xl" /></FinanceShell>;
  if (context.error || query.error || !query.data) return <FinanceShell title="Detail Pengeluaran"><Alert variant="destructive"><AlertTitle>Detail pengeluaran tidak tersedia</AlertTitle><AlertDescription>{errorMessage(context.error ?? query.error)}</AlertDescription></Alert></FinanceShell>;

  const item = query.data;
  const sourceType = item.source_type?.toLowerCase() ?? null;
  const sourceRequired = sourceType === "purchase" || sourceType === "maintenance";
  const sourceTrace = sourceRequired && item.source_id
    ? <SourcePreview type={sourceType === "purchase" ? "Pembelian" : "Perawatan"} number={item.source_id} meta="Hubungan Sumber" />
    : <div className="rounded-2xl border border-dashed p-4"><p className="text-sm font-semibold">{sourceType ? "Sumber belum ditautkan" : "Sumber tidak diperlukan"}</p><p className="mt-1 text-xs text-muted-foreground">{sourceType ? "Sumber tercatat tetapi nomor detailnya belum tersedia untuk ditampilkan." : "Kategori ini dapat dicatat tanpa sumber."}</p></div>;

  return (
    <FinanceShell
      title="Detail Pengeluaran"
      subtitle={item.nomor_transaksi ? "Transaksi keuangan " + item.nomor_transaksi : "Pengeluaran"}
      action={
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" className="rounded-xl"><Link to={paths.keuangan + "/pengeluaran"}><ArrowLeft />Kembali</Link></Button>
          <Button variant="outline" className="rounded-xl" onClick={() => { setCorrectionResult(null); setCorrectionError(null); setBusinessConflict(false); setUnknownOutcome(false); setCorrectionOpen(true); }}>Koreksi</Button>
        </div>
      }
    >
      <section className="rounded-[28px] border bg-card p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pengeluaran</p>
            <h2 className="mt-1 text-xl font-bold">{item.deskripsi}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{semanticFinanceLabel(item.source_type ?? item.kategori_biaya)} · {semanticFinanceLabel(item.kategori_biaya)} · {formatFinanceDate(item.tanggal_pengeluaran, context.data.timezone)}</p>
          </div>
          <AmountDisplay amount={item.amount} direction="expense" />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <Card><CardHeader><CardTitle className="text-base">Fakta Pengeluaran</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
          <Info label="Jenis Sumber" value={semanticFinanceLabel(item.source_type ?? item.kategori_biaya)} />
          <Info label="Tanggal bisnis" value={formatFinanceDate(item.tanggal_pengeluaran, context.data.timezone)} />
          <Info label="Pemasok" value={item.pemasok_nama ?? "Tidak ditautkan"} />
          <Info label="Nominal" value={formatFinanceMoney(item.amount, item.currency_code)} />
          <Info label="Bukti" value={item.bukti_storage_path ? "Bukti Tersedia" : "Bukti Tidak Ada"} />
          <Info label="Transaksi Keuangan" value={item.nomor_transaksi ?? "-"} />
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Source Trace</CardTitle></CardHeader><CardContent className="space-y-3">{sourceTrace}</CardContent></Card>
      </div>

      <Card><CardContent className="space-y-3 p-5"><p className="text-sm font-semibold">Transaksi Keuangan</p><p className="text-xs leading-5 text-muted-foreground">{item.nomor_transaksi ?? "-"} · Pengeluaran tercatat. Ini tidak menyimpulkan Pembelian Sudah Diterima atau Perawatan Sudah Selesai.</p></CardContent></Card>

      <FinanceCorrectionDialog
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        title="Koreksi Pengeluaran"
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

ExpenseList.displayName = "ExpenseList";
ExpenseShow.displayName = "ExpenseShow";
