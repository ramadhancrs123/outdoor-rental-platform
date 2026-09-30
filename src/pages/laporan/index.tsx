import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { getFinancialReport } from "@/features/laporan/service";
import type { FinancialReport } from "@/features/laporan/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { paths } from "@/routes/paths";

function isoDate(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function defaultPeriod() {
  const now = new Date();
  return {
    start: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
  };
}

function money(value: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

export function LaporanPage() {
  const { current } = useCurrentUsaha();
  const initial = useMemo(() => defaultPeriod(), []);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usahaId = current?.usahaId;

  const load = useCallback(async () => {
    if (!usahaId) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await getFinancialReport(usahaId, start, end));
    } catch (cause) {
      setReport(null);
      setError(cause instanceof Error ? cause.message : "Laporan gagal dimuat.");
    } finally {
      setBusy(false);
    }
  }, [usahaId, start, end]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5 pb-8" data-testid="reports-page">
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Insight</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Laporan</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read model turunan. Angka finansial dibaca dari Finance dan dapat ditelusuri kembali ke source record.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs">
            Mulai
            <input className="h-9 rounded-md border bg-background px-3" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs">
            Sampai (eksklusif)
            <input className="h-9 rounded-md border bg-background px-3" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw className="size-4" /> Muat ulang
          </Button>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}

      {busy && !report ? (
        <Card><CardContent className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Memuat laporan...</CardContent></Card>
      ) : report ? (
        <>
          <Card>
            <CardContent className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">Finance → Laporan</p>
                <p className="text-xs text-muted-foreground">
                  Sumber: {report.period.start_date} sampai {report.period.end_date_exclusive} · timezone {report.period.timezone}
                </p>
              </div>
              <Button asChild variant="outline" size="sm"><Link to={paths.keuangan + "/transaksi"}>Buka sumber transaksi <ArrowUpRight className="size-4" /></Link></Button>
            </CardContent>
          </Card>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Pemasukan tercatat", money(report.summary.recorded_income)],
              ["Pengeluaran tercatat", money(report.summary.recorded_expense)],
              ["Net operasional", money(report.summary.net_operational_movement)],
              ["Jumlah pembayaran", String(report.summary.recorded_payment_count)],
            ].map(([label, value]) => (
              <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></CardContent></Card>
            ))}
          </section>

          <Card>
            <CardContent className="grid gap-3 p-4 text-xs sm:grid-cols-2 lg:grid-cols-5">
              <div><p className="font-semibold text-foreground">Source</p><p className="mt-1 text-muted-foreground">Finance / transaksi keuangan</p></div>
              <div><p className="font-semibold text-foreground">Time basis</p><p className="mt-1 text-muted-foreground">{report.period.start_date} → {report.period.end_date_exclusive} · {report.period.timezone}</p></div>
              <div><p className="font-semibold text-foreground">Tenant</p><p className="mt-1 text-muted-foreground">{current?.usahaNama ?? "Usaha aktif"}</p></div>
              <div><p className="font-semibold text-foreground">Formula</p><p className="mt-1 text-muted-foreground">Net = recorded income − recorded expense; payment count dihitung dari Finance</p></div>
              <div><p className="font-semibold text-foreground">Drill-down</p><p className="mt-1"><Link className="text-primary hover:underline" to={paths.keuangan + "/transaksi"}>Buka source record</Link></p></div>
            </CardContent>
          </Card>

          <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3"><CardTitle className="text-base">Transaksi Finansial</CardTitle><Badge variant="outline">{report.transactions.total} record</Badge></CardHeader>
              <CardContent className="space-y-2">
                {report.transactions.items.length === 0 ? <p className="text-sm text-muted-foreground">Tidak ada transaksi pada periode ini.</p> : report.transactions.items.map((row) => (
                  <Link key={row.transaksi_keuangan_id} to={paths.keuangan + "/transaksi/" + row.transaksi_keuangan_id} className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/40">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{row.nomor_transaksi}</p><p className="text-xs text-muted-foreground">{row.jenis} · {row.sumber_type ?? "tanpa sumber"}</p></div>
                    <span className="shrink-0 text-sm font-semibold">{money(Number(row.amount))}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Biaya per Kategori</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {report.expenseAnalysis.by_category.length === 0 ? <p className="text-sm text-muted-foreground">Tidak ada pengeluaran pada periode ini.</p> : report.expenseAnalysis.by_category.map((item) => (
                  <div key={item.kategori_biaya} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div><p className="text-sm font-medium">{item.kategori_biaya}</p><p className="text-xs text-muted-foreground">{item.count} transaksi</p></div>
                    <span className="font-semibold">{money(item.amount)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Atribusi Pendapatan per Barang</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">{report.productRevenue.allocation_policy} · coverage {report.productRevenue.coverage_ratio === null ? "n/a" : Math.round(report.productRevenue.coverage_ratio * 100) + "%"}</p>
                {report.productRevenue.items.slice(0, 10).map((item) => (
                  <div key={(item.barang_id ?? "barang") + "-" + (item.varian_barang_id ?? "varian")} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <span className="text-sm">{item.barang_id ?? "Barang tidak teridentifikasi"}</span>
                    <span className="font-semibold">{money(item.recorded_income_exact)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Atribusi Pendapatan per Unit</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">{report.unitRevenue.allocation_policy} · coverage {report.unitRevenue.coverage_ratio === null ? "n/a" : Math.round(report.unitRevenue.coverage_ratio * 100) + "%"}</p>
                {report.unitRevenue.items.slice(0, 10).map((item) => (
                  <div key={item.unit_barang_id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <span className="text-sm">{item.kode_unit}</span>
                    <span className="font-semibold">{money(item.recorded_income_exact)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
}

LaporanPage.displayName = "LaporanPage";
