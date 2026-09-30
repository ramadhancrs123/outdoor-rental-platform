import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, WalletCards } from "lucide-react";
import { Link, useParams } from "react-router";

import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FinancePeriodBar, FinanceShell, FinanceStatus } from "@/components/keuangan/finance-ui";
import {
  getFinanceTransactionPage,
  getKeuanganContext,
  getTransaction,
  useFinancePeriod,
  formatFinanceDateTime,
  formatFinanceMoney,
  formatFinancePeriodLabel,
  formatFinanceTimezone,
  semanticFinanceLabel,
} from "@/features/keuangan";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Data transaksi gagal dimuat.";
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "recorded" || normalized === "valid" || normalized === "posted") return "success" as const;
  if (normalized.includes("void") || normalized.includes("reverse") || normalized === "failed") return "danger" as const;
  return "neutral" as const;
}

export function TransactionList() {
  const context = useQuery({ queryKey: ["keuangan", "context"], queryFn: getKeuanganContext, staleTime: 60_000 });
  const periodState = useFinancePeriod(context.data?.timezone ?? "Asia/Jakarta");
  const query = useQuery({
    queryKey: ["keuangan", "transactions", context.data?.usahaId, periodState.period],
    queryFn: () =>
      getFinanceTransactionPage(
        context.data!.usahaId,
        periodState.period.startDate,
        periodState.period.endDateExclusive,
        20,
        0,
      ),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });
  const data = query.data;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 20)));
  const offsetPage = data ? Math.floor(data.offset / data.limit) + 1 : 1;

  const fetchPage = async (page: number) => {
    if (!context.data || !data) return;
    const next = await getFinanceTransactionPage(
      context.data.usahaId,
      data.start_date,
      data.end_date_exclusive,
      data.limit,
      (page - 1) * data.limit,
    );
    queryClient.setQueryData(["keuangan", "transactions", context.data.usahaId, periodState.period], next);
  };
  const queryClient = useQueryClient();

  if (context.isPending) return <FinanceShell title="Transaksi Keuangan"><Skeleton className="h-96 rounded-2xl" /></FinanceShell>;
  if (context.error || !context.data) {
    return <FinanceShell title="Transaksi Keuangan"><Alert variant="destructive"><AlertTitle>Transaksi belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert></FinanceShell>;
  }

  return (
    <FinanceShell
      title="Transaksi Keuangan"
      subtitle="Server page read model. Nominal, status, source, dan tanggal berasal dari Financial Truth."
      action={<Button asChild variant="ghost" className="-ml-3 rounded-xl"><Link to={paths.keuangan}><ArrowLeft />Kembali</Link></Button>}
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
          <AlertTitle>Daftar transaksi belum tersedia</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{errorMessage(query.error)}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}><RefreshCw />Coba lagi</Button>
          </AlertDescription>
        </Alert>
      ) : data && data.items.length === 0 ? (
        <Card><CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"><WalletCards className="size-9 text-muted-foreground" /><h2 className="font-semibold">Belum ada transaksi pada periode ini</h2><p className="max-w-md text-sm text-muted-foreground">Periode dan timezone di atas adalah konteks server untuk daftar ini.</p></CardContent></Card>
      ) : data ? (
        <>
          <div className="rounded-2xl border bg-card p-3 text-xs text-muted-foreground shadow-sm">
            Periode server: <span className="font-semibold text-foreground">{formatFinancePeriodLabel(data.start_date, data.end_date_exclusive, data.timezone)}</span> · {data.total} transaksi
          </div>
          <div className="grid gap-3 md:hidden">
            {data.items.map((item) => (
              <Link key={item.transaksi_keuangan_id} to={paths.keuangan + "/transaksi/" + item.transaksi_keuangan_id}>
                <Card className="transition-colors hover:bg-accent/40">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{item.nomor_transaksi}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{semanticFinanceLabel(item.jenis)} · {semanticFinanceLabel(item.arah)}</p>
                      </div>
                      <FinanceStatus status={semanticFinanceLabel(item.status)} tone={statusTone(item.status)} />
                    </div>
                    <p className="text-lg font-bold tabular-nums">{formatFinanceMoney(item.amount, item.currency_code)}</p>
                    <div className="border-t pt-3 text-xs text-muted-foreground">
                      <p>{formatFinanceDateTime(item.tanggal_transaksi, data.timezone)}</p>
                      <p className="mt-1">Source: {semanticFinanceLabel(item.sumber_type) ?? "-"}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <Card className="hidden overflow-hidden shadow-sm md:block">
            <CardHeader className="border-b bg-muted/20"><CardTitle className="text-base">Daftar Transaksi</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30 text-left">
                    <tr><th className="px-5 py-3 font-medium">Date</th><th className="px-5 py-3 font-medium">Type</th><th className="px-5 py-3 font-medium">Direction</th><th className="px-5 py-3 font-medium">Source</th><th className="px-5 py-3 font-medium">Amount</th><th className="px-5 py-3 font-medium">Status</th></tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.transaksi_keuangan_id} className="border-b last:border-0">
                        <td className="px-5 py-4"><Link to={paths.keuangan + "/transaksi/" + item.transaksi_keuangan_id} className="font-semibold hover:text-primary hover:underline">{formatFinanceDateTime(item.tanggal_transaksi, data.timezone)}</Link></td>
                        <td className="px-5 py-4">{semanticFinanceLabel(item.jenis)}</td>
                        <td className="px-5 py-4">{semanticFinanceLabel(item.arah)}</td>
                        <td className="px-5 py-4">{semanticFinanceLabel(item.sumber_type)}</td>
                        <td className="px-5 py-4 font-semibold tabular-nums">{formatFinanceMoney(item.amount, item.currency_code)}</td>
                        <td className="px-5 py-4"><FinanceStatus status={semanticFinanceLabel(item.status)} tone={statusTone(item.status)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
            <span className="text-muted-foreground">Halaman {offsetPage} dari {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" disabled={offsetPage <= 1} onClick={() => void fetchPage(offsetPage - 1)}>Sebelumnya</Button>
              <Button variant="outline" disabled={offsetPage >= totalPages} onClick={() => void fetchPage(offsetPage + 1)}>Berikutnya</Button>
            </div>
          </div>
        </>
      ) : null}
    </FinanceShell>
  );
}

export function TransactionShow() {
  const { id } = useParams<{ id: string }>();
  const context = useQuery({ queryKey: ["keuangan", "context"], queryFn: getKeuanganContext, staleTime: 60_000 });
  const query = useQuery({
    queryKey: ["keuangan", "transaction", context.data?.usahaId, id],
    queryFn: () => getTransaction(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
  });

  if (context.isPending || query.isPending) return <FinanceShell title="Detail Transaksi"><Skeleton className="h-[650px] rounded-2xl" /></FinanceShell>;
  if (context.error || query.error || !query.data) return <FinanceShell title="Detail Transaksi"><Alert variant="destructive"><AlertTitle>Detail transaksi tidak tersedia</AlertTitle><AlertDescription>{errorMessage(context.error ?? query.error)}</AlertDescription></Alert></FinanceShell>;

  const item = query.data;
  return (
    <FinanceShell
      title={item.nomor_transaksi}
      subtitle="Financial fact detail. Tidak ada generic edit."
      action={<Button asChild variant="ghost" className="-ml-3 rounded-xl"><Link to={paths.keuangan + "/transaksi"}><ArrowLeft />Kembali</Link></Button>}
    >
      <Card className="shadow-sm">
        <CardHeader><CardTitle className="text-base">Fakta transaksi</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Info label="Jenis" value={semanticFinanceLabel(item.jenis)} />
          <Info label="Arah" value={semanticFinanceLabel(item.arah)} />
          <Info label="Nominal" value={formatFinanceMoney(item.amount, item.currency_code)} />
          <Info label="Tanggal bisnis" value={formatFinanceDateTime(item.tanggal_transaksi, context.data.timezone)} />
          <Info label="Source Type" value={semanticFinanceLabel(item.sumber_type)} />
          <Info label="Source ID" value={item.sumber_id ?? "-"} />
          <Info label="Status" value={semanticFinanceLabel(item.status)} />
          <Info label="Currency" value={item.currency_code} />
          <div className="sm:col-span-2"><Info label="Catatan" value={item.catatan ?? "-"} /></div>
        </CardContent>
      </Card>
      <Card className="border-primary/10 bg-primary/[0.03] shadow-sm">
        <CardContent className="space-y-3 p-5">
          <p className="text-sm font-semibold">Traceability</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Financial Transaction → {semanticFinanceLabel(item.sumber_type) || "Source"} → {item.sumber_id ?? "source tidak ditautkan"}.
            Koreksi dilakukan melalui command correction domain, bukan edit nominal langsung.
          </p>
        </CardContent>
      </Card>
    </FinanceShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p></div>;
}
