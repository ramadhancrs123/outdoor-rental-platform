import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowUpRight,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getFinanceExportReport, getRentalExportReport } from "@/features/laporan/export-service";
import {
  formatFinanceKind,
  formatFinanceSource,
  formatRentalStatus,
  type FinanceExportReport,
  type RentalExportReport,
} from "@/features/laporan/export-service";
import { exportFinanceReportToExcel, exportRentalReportToExcel } from "@/features/laporan/excel";
import { exportFinanceReportToPdf, exportRentalReportToPdf } from "@/features/laporan/pdf";
import { getPenyewaanContext } from "@/features/penyewaan/service";
import { paths } from "@/routes/paths";

type ReportModule = "keuangan" | "penyewaan";
type ExportFormat = "excel" | "pdf" | null;

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
    end: isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function addDays(dateString: string, amount: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return "";
  const value = new Date(dateString + "T00:00:00.000Z");
  if (Number.isNaN(value.getTime())) return "";
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function money(value: number, currencyCode = "IDR") {
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value) + " " + currencyCode;
  }
}

function displayDatePeriod(start: string, end: string) {
  return start + " s.d. " + end;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Laporan gagal dimuat.";
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="rounded-2xl border-border/70 shadow-none">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 break-words text-lg font-bold tabular-nums sm:text-xl">{value}</p>
        {detail ? <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

export function LaporanPage() {
  const { current, status: usahaStatus, error: usahaError } = useCurrentUsaha();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeModule: ReportModule = searchParams.get("modul") === "penyewaan" ? "penyewaan" : "keuangan";
  const initial = useMemo(() => defaultPeriod(), []);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [financeReport, setFinanceReport] = useState<FinanceExportReport | null>(null);
  const [rentalReport, setRentalReport] = useState<RentalExportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState<ExportFormat>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const usahaId = current?.usahaId;
  const endExclusive = useMemo(() => (end ? addDays(end, 1) : ""), [end]);
  const invalidPeriod = !start || !end || !endExclusive || start > end;

  const selectModule = (module: ReportModule) => {
    setSearchParams(module === "keuangan" ? {} : { modul: "penyewaan" });
  };

  const load = useCallback(async () => {
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    if (!usahaId) {
      setBusy(usahaStatus === "loading");
      return;
    }
    if (!start || !end || !endExclusive || !(start < endExclusive)) {
      setError("Rentang tanggal laporan tidak valid.");
      if (activeModule === "keuangan") setFinanceReport(null);
      else setRentalReport(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    setError(null);
    setExportError(null);
    try {
      if (activeModule === "keuangan") {
        const result = await getFinanceExportReport(usahaId, start, endExclusive, false);
        if (sequence !== loadSequence.current) return;
        setFinanceReport(result);
      } else {
        setFinanceReport(null);
        const context = await getPenyewaanContext();
        const result = await getRentalExportReport(usahaId, start, endExclusive, context.timezone);
        if (sequence !== loadSequence.current) return;
        setRentalReport(result);
      }
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      if (activeModule === "keuangan") setFinanceReport(null);
      else setRentalReport(null);
      setError(errorMessage(cause));
    } finally {
      if (sequence === loadSequence.current) setBusy(false);
    }
  }, [activeModule, end, endExclusive, start, usahaId, usahaStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportReport = async (format: Exclude<ExportFormat, null>) => {
    if (!usahaId || invalidPeriod) return;
    setExportBusy(format);
    setExportError(null);
    try {
      if (activeModule === "keuangan") {
        const completeReport = await getFinanceExportReport(usahaId, start, endExclusive, true);
        if (format === "excel") await exportFinanceReportToExcel(completeReport, current?.usahaNama ?? "Usaha");
        else await exportFinanceReportToPdf(completeReport, current?.usahaNama ?? "Usaha");
      } else {
        let completeReport = rentalReport;
        if (!completeReport || completeReport.period.start_date !== start || completeReport.period.end_date_exclusive !== endExclusive) {
          const context = await getPenyewaanContext();
          completeReport = await getRentalExportReport(usahaId, start, endExclusive, context.timezone);
          setRentalReport(completeReport);
        }
        if (format === "excel") await exportRentalReportToExcel(completeReport, current?.usahaNama ?? "Usaha");
        else await exportRentalReportToPdf(completeReport, current?.usahaNama ?? "Usaha");
      }
    } catch (cause) {
      setExportError(errorMessage(cause));
    } finally {
      setExportBusy(null);
    }
  };

  const isFinance = activeModule === "keuangan";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-28 sm:pb-8" data-testid="reports-page">
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Laporan operasional</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Laporan</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Ringkasan dan data rinci Keuangan serta Penyewaan. Pilih periode lalu ekspor ke Excel atau PDF.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs">
            Tanggal mulai
            <input className="h-10 rounded-lg border bg-background px-3" type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs">
            Tanggal selesai
            <input className="h-10 rounded-lg border bg-background px-3" type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} />
          </label>
          <Button variant="outline" className="h-10" onClick={() => void load()} disabled={busy || invalidPeriod}>
            <RefreshCw className={"size-4 " + (busy ? "animate-spin" : "")} /> Muat ulang
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2" aria-label="Jenis laporan">
          <Button
            type="button"
            variant={isFinance ? "default" : "outline"}
            className="h-10 rounded-xl"
            aria-pressed={isFinance}
            onClick={() => selectModule("keuangan")}
          >
            Keuangan
          </Button>
          <Button
            type="button"
            variant={!isFinance ? "default" : "outline"}
            className="h-10 rounded-xl"
            aria-pressed={!isFinance}
            onClick={() => selectModule("penyewaan")}
          >
            Penyewaan
          </Button>
        </div>
        <div className="flex flex-col gap-1 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void exportReport("excel")} disabled={busy || Boolean(exportBusy) || invalidPeriod}>
              {exportBusy === "excel" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
              {exportBusy === "excel" ? "Menyiapkan Excel..." : "Ekspor Excel (.xlsx)"}
            </Button>
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => void exportReport("pdf")} disabled={busy || Boolean(exportBusy) || invalidPeriod}>
              {exportBusy === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              {exportBusy === "pdf" ? "Menyiapkan PDF..." : "Ekspor PDF"}
            </Button>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground sm:text-right">
            Excel untuk rincian dan rekonsiliasi; PDF untuk ringkasan siap cetak.
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Usaha: <strong className="font-semibold text-foreground">{current?.usahaNama ?? "Usaha aktif"}</strong></span>
        <span>Periode: {displayDatePeriod(start, end)} · {isFinance ? "berdasarkan tanggal transaksi Finance" : "berdasarkan tanggal mulai jadwal penyewaan"}</span>
      </div>

      {invalidPeriod ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Tanggal mulai tidak boleh melewati tanggal selesai, dan kedua tanggal wajib diisi.</div> : null}
      {!current && usahaStatus === "error" ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{usahaError?.message ?? "Usaha aktif tidak dapat diverifikasi."}</div> : null}
      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
      {exportError ? <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{exportError}</div> : null}

      {busy ? (
        <Card className="rounded-2xl"><CardContent className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {current ? "Menyiapkan laporan " + (isFinance ? "keuangan" : "penyewaan") + "..." : "Memuat konteks usaha aktif..."}</CardContent></Card>
      ) : null}

      {!busy && isFinance && financeReport ? (
        <>
          {financeReport.currencySummaries.length ? (
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {financeReport.currencySummaries.flatMap((summary) => [
                <MetricCard key={summary.currency_code + "-income"} label={"Pemasukan (" + summary.currency_code + ")"} value={money(summary.recorded_income, summary.currency_code)} detail={summary.recorded_income_transaction_count + " transaksi tercatat"} />,
                <MetricCard key={summary.currency_code + "-expense"} label={"Pengeluaran (" + summary.currency_code + ")"} value={money(summary.recorded_expense, summary.currency_code)} detail={summary.recorded_expense_transaction_count + " transaksi tercatat"} />,
                <MetricCard key={summary.currency_code + "-net"} label={"Net transaksi (" + summary.currency_code + ")"} value={money(summary.net_operational_movement, summary.currency_code)} detail="Pemasukan dikurangi pengeluaran tercatat; bukan laba bersih atau saldo kas." />,
                <MetricCard key={summary.currency_code + "-payments"} label={"Pembayaran (" + summary.currency_code + ")"} value={money(summary.recorded_payment_amount, summary.currency_code)} detail={summary.recorded_payment_count + " baris; tidak dijumlahkan ke transaksi Finance"} />,
              ])}
            </section>
          ) : (
            <Card className="rounded-2xl"><CardContent className="p-4 text-sm text-muted-foreground">Belum ada transaksi/pembayaran tercatat pada periode ini.</CardContent></Card>
          )}
          {financeReport.hasMultipleCurrencies ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">Periode ini memuat beberapa mata uang. Ringkasan ditampilkan per mata uang; nominal tidak dijumlahkan lintas mata uang.</p>
          ) : null}

          <Card className="rounded-2xl border-border/70 shadow-none">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">Ringkasan Keuangan</p>
                <p className="mt-1 text-xs text-muted-foreground">Sumber utama: transaksi, pembayaran, pengeluaran, analisis biaya, serta atribusi pendapatan barang/unit.</p>
              </div>
              <Button asChild variant="outline" size="sm" className="rounded-lg">
                <Link to={paths.keuangan + "/transaksi"}>Buka transaksi sumber <ArrowUpRight className="size-4" /></Link>
              </Button>
            </CardContent>
          </Card>

          <section className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
            <Card className="rounded-2xl border-border/70 shadow-none">
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle className="text-base">Transaksi Keuangan</CardTitle>
                <Badge variant="outline">{financeReport.transactions.length} data</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {financeReport.transactions.length === 0 ? <p className="text-sm text-muted-foreground">Tidak ada transaksi pada periode ini.</p> : financeReport.transactions.slice(0, 10).map((row) => (
                  <Link key={row.transaksi_keuangan_id} to={paths.keuangan + "/transaksi/" + row.transaksi_keuangan_id} className="flex items-center justify-between gap-3 rounded-xl border p-3 hover:bg-muted/40">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{row.nomor_transaksi}</p><p className="text-xs text-muted-foreground">{formatFinanceKind(row.jenis)} · {formatFinanceSource(row.sumber_type)}</p></div>
                    <span className="shrink-0 text-sm font-semibold">{money(Number(row.amount), row.currency_code)}</span>
                  </Link>
                ))}
                {financeReport.transactions.length > 10 ? <p className="text-xs text-muted-foreground">Menampilkan 10 transaksi pertama. Ekspor memuat seluruh data periode.</p> : null}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-border/70 shadow-none">
              <CardHeader><CardTitle className="text-base">Pengeluaran per Kategori</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {financeReport.expenseByCategoryCurrency.length === 0 ? <p className="text-sm text-muted-foreground">Tidak ada pengeluaran pada periode ini.</p> : financeReport.expenseByCategoryCurrency.slice(0, 10).map((item) => (
                  <div key={item.currency_code + "-" + item.key} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                    <div><p className="text-sm font-medium">{item.key}</p><p className="text-xs text-muted-foreground">{item.count} transaksi · {item.currency_code}</p></div>
                    <span className="text-sm font-semibold">{money(item.amount, item.currency_code)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

        </>
      ) : null}

      {!busy && !isFinance && rentalReport ? (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard label="Jumlah penyewaan" value={String(rentalReport.summary.rental_count)} detail={rentalReport.summary.active_count + " aktif/berjalan · " + rentalReport.summary.completed_count + " selesai"} />
            {rentalReport.currencySummaries.map((summary) => [
              <MetricCard key={summary.currency_code + "-contract"} label={"Nilai kontrak (" + summary.currency_code + ")"} value={money(summary.contractual_value, summary.currency_code)} />,
              <MetricCard key={summary.currency_code + "-payment"} label={"Pembayaran terkait sewa (" + summary.currency_code + ")"} value={money(summary.recorded_payment_total, summary.currency_code)} detail="Seluruh tanggal bayar untuk penyewaan yang mulai dalam periode." />,
              <MetricCard key={summary.currency_code + "-balance"} label={"Sisa tagihan (" + summary.currency_code + ")"} value={money(summary.balance_due_total, summary.currency_code)} detail="Berdasarkan DP/pelunasan pada mata uang kontrak." />,
              <MetricCard key={summary.currency_code + "-fee"} label={"Estimasi denda aktif (" + summary.currency_code + ")"} value={money(summary.estimated_late_fee_total, summary.currency_code)} detail={money(summary.approved_late_fee_total, summary.currency_code) + " disetujui · " + money(summary.pending_late_fee_total, summary.currency_code) + " menunggu review"} />,
            ])}
          </section>
          {rentalReport.hasMultipleCurrencies ? <p className="text-xs text-amber-700 dark:text-amber-400">Nilai dikelompokkan per mata uang. Pembayaran dengan mata uang berbeda dari kontrak tidak mengurangi sisa tagihan kontrak.</p> : null}

          <Card className="rounded-2xl border-border/70 shadow-none">
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">Daftar Penyewaan</p>
                  <p className="mt-1 text-xs text-muted-foreground">{rentalReport.period.basis}</p>
                </div>
                <Badge variant="outline">{rentalReport.items.length} penyewaan</Badge>
              </div>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[850px] text-left text-xs">
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Nomor / Penyewa</th>
                      <th className="px-3 py-2.5 font-semibold">Status</th>
                      <th className="px-3 py-2.5 font-semibold">Jadwal</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Nilai</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Sisa Tagihan</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Estimasi Denda</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Denda Disetujui</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rentalReport.items.slice(0, 15).map((item) => (
                      <tr key={item.penyewaan_id} className="border-t">
                        <td className="px-3 py-2.5"><Link className="font-semibold text-primary hover:underline" to={paths.penyewaan + "/" + item.penyewaan_id}>{item.nomor_penyewaan}</Link><p className="mt-0.5 max-w-52 truncate text-muted-foreground">{item.penyewa_nama ?? "Nama tidak tersedia"}</p></td>
                        <td className="px-3 py-2.5">{formatRentalStatus(item.status)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{item.jadwal_mulai.slice(0, 10)}<p className="mt-0.5 text-muted-foreground">s.d. {item.jadwal_kembali.slice(0, 10)}</p></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{money(Number(item.total_amount), item.currency_code)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{money(item.balance_due, item.currency_code)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{money(Number(item.late_fee_assessment?.amount ?? 0), item.currency_code)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{money(item.approved_late_fee, item.currency_code)}</td>
                      </tr>
                    ))}
                    {rentalReport.items.length === 0 ? <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Tidak ada penyewaan pada periode ini.</td></tr> : null}
                  </tbody>
                </table>
              </div>
              {rentalReport.items.length > 15 ? <p className="text-xs text-muted-foreground">Menampilkan 15 dari {rentalReport.items.length} penyewaan. Ekspor memuat semua data yang ditemukan.</p> : null}
              {rentalReport.items.some((item) => item.payment_currency_mismatch_count > 0 || item.late_fee_currency_mismatch_count > 0) ? <p className="text-xs text-amber-700 dark:text-amber-400">Ada pembayaran atau review denda dengan mata uang berbeda dari kontrak. Nilai tersebut ditandai di ekspor dan tidak digunakan untuk menghitung saldo/denda dalam mata uang kontrak.</p> : null}
              <p className="text-xs text-muted-foreground">Nilai denda yang disetujui berasal dari review Finance; estimasi denda bukan otomatis bukti pembayaran.</p>
            </CardContent>
          </Card>
        </>
      ) : null}

      {!busy && current && !error && ((isFinance && !financeReport) || (!isFinance && !rentalReport)) ? (
        <Card className="rounded-2xl"><CardContent className="flex min-h-32 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <Download className="size-5" />
          Laporan belum memiliki data untuk periode ini.
        </CardContent></Card>
      ) : null}
    </div>
  );
}

LaporanPage.displayName = "LaporanPage";
