import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, ReceiptText, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AmountDisplay,
  FinanceCorrectionDialog,
  FinancePeriodBar,
  FinanceShell,
  FinanceStatus,
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
  formatFinanceTimezone,
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

export function ExpenseList() {
  const queryClient = useQueryClient();
  const context = useQuery({ queryKey: ["keuangan", "context"], queryFn: getKeuanganContext, staleTime: 60_000 });
  const periodState = useFinancePeriod(context.data?.timezone ?? "Asia/Jakarta");
  const query = useQuery({
    queryKey: ["keuangan", "expenses-f3", context.data?.usahaId, periodState.period],
    queryFn: () =>
      getFinanceExpensePage(
        context.data!.usahaId,
        periodState.period.startDate,
        periodState.period.endDateExclusive,
        20,
        0,
      ),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  if (context.isPending) return <FinanceShell title="Pengeluaran"><Skeleton className="h-96 rounded-2xl" /></FinanceShell>;
  if (context.error || !context.data) {
    return <FinanceShell title="Pengeluaran"><Alert variant="destructive"><AlertTitle>Pengeluaran belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert></FinanceShell>;
  }

  const data = query.data;
  const currentPage = data ? Math.floor(data.offset / data.limit) + 1 : 1;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 20)));

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
    <FinanceShell
      title="Pengeluaran"
      subtitle="Pengeluaran tercatat dari sistem. Data sumber tetap dikelola pada menu asalnya."
      action={<Button asChild className="rounded-xl"><Link to={paths.keuangan + "/pengeluaran/create"}><Plus />Catat Pengeluaran</Link></Button>}
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
        <Alert variant="destructive">
          <AlertTitle>Daftar pengeluaran belum tersedia</AlertTitle>
          <AlertDescription className="space-y-3"><p>{errorMessage(query.error)}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription>
        </Alert>
      ) : data && data.items.length === 0 ? (
        <Card><CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 text-center"><ReceiptText className="size-9 text-muted-foreground" /><h2 className="text-lg font-semibold">Belum ada pengeluaran pada periode ini</h2><p className="max-w-md text-sm text-muted-foreground">Periode menggunakan business date dan timezone Usaha.</p><Button asChild variant="outline" className="rounded-xl"><Link to={paths.keuangan + "/pengeluaran/create"}>Catat Pengeluaran</Link></Button></CardContent></Card>
      ) : data ? (
        <>
          <div className="rounded-2xl border bg-card p-3 text-xs text-muted-foreground shadow-sm">
            Periode server: <span className="font-semibold text-foreground">{formatFinancePeriodLabel(data.start_date, data.end_date_exclusive, data.timezone)}</span> · {data.total} expense
          </div>
          <div className="grid gap-3 md:hidden">
            {data.items.map((item) => (
              <Link key={item.pengeluaran_id} to={paths.keuangan + "/pengeluaran/" + item.pengeluaran_id}>
                <Card className="transition-colors hover:bg-accent/40">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">{semanticFinanceLabel(item.source_type ?? item.kategori_biaya)}</p>
                        <p className="mt-1 text-sm font-semibold">{item.deskripsi}</p>
                      </div>
                      <FinanceStatus status="Recorded" tone="success" />
                    </div>
                    <AmountDisplay amount={item.amount} direction="expense" compact />
                    <p className="text-xs text-muted-foreground">{item.pemasok_nama ?? "Tanpa pemasok"} · {formatFinanceDate(item.tanggal_pengeluaran, data.timezone)}</p>
                    <p className="text-xs text-muted-foreground">Transaksi Keuangan: {item.nomor_transaksi ?? "-"}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <Card className="hidden overflow-hidden shadow-sm md:block">
            <CardHeader className="border-b bg-muted/20"><CardTitle className="text-base">Daftar Pengeluaran</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30 text-left"><tr><th className="px-5 py-3 font-medium">Date</th><th className="px-5 py-3 font-medium">Description</th><th className="px-5 py-3 font-medium">Source</th><th className="px-5 py-3 font-medium">Pemasok</th><th className="px-5 py-3 font-medium">Amount</th><th className="px-5 py-3 font-medium">Transaction</th></tr></thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.pengeluaran_id} className="border-b last:border-0">
                        <td className="px-5 py-4"><Link to={paths.keuangan + "/pengeluaran/" + item.pengeluaran_id} className="font-semibold hover:text-primary hover:underline">{formatFinanceDate(item.tanggal_pengeluaran, data.timezone)}</Link></td>
                        <td className="px-5 py-4 font-semibold">{item.deskripsi}</td>
                        <td className="px-5 py-4">{semanticFinanceLabel(item.source_type ?? item.kategori_biaya)}</td>
                        <td className="px-5 py-4">{item.pemasok_nama ?? "-"}</td>
                        <td className="px-5 py-4 font-semibold tabular-nums">{formatFinanceMoney(item.amount, item.currency_code)}</td>
                        <td className="px-5 py-4 font-mono text-xs">{item.nomor_transaksi ?? "-"}</td>
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
              <Button variant="outline" disabled={currentPage <= 1} onClick={() => void changePage(currentPage - 1)}>Sebelumnya</Button>
              <Button variant="outline" disabled={currentPage >= totalPages} onClick={() => void changePage(currentPage + 1)}>Berikutnya</Button>
            </div>
          </div>
        </>
      ) : null}
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
        idempotencyKey: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
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
