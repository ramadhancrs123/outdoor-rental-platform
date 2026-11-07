import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  PackageCheck,
  Receipt,
  RefreshCw,
  ShoppingBag,
  Tag,
  TentTree,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatFinanceKind,
  formatFinanceSource,
  formatRentalStatus,
  getFinanceExportReport,
  getRentalExportReport,
  type FinanceExportReport,
  type RentalExportReport,
} from "@/features/laporan/export-service";
import { exportFinanceReportToExcel, exportRentalReportToExcel } from "@/features/laporan/excel";
import { exportFinanceReportToPdf, exportRentalReportToPdf } from "@/features/laporan/pdf";
import { getPenyewaanContext } from "@/features/penyewaan/service";
import { paths } from "@/routes/paths";

type ReportModule = "keuangan" | "penyewaan";
type ExportFormat = "excel" | "pdf" | null;
type PeriodPreset = "today" | "last7" | "thisMonth" | "lastMonth" | "custom";

const dashboardSurface =
  "rounded-[1.2rem] border border-border/60 bg-card shadow-[0_5px_24px_rgba(35,55,45,.05)]";
const dashboardPadding = "p-3.5 sm:p-4";

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

function rangeForPreset(preset: Exclude<PeriodPreset, "custom">) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === "today") return { start: isoDate(today), end: isoDate(today) };
  if (preset === "last7") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start: isoDate(start), end: isoDate(today) };
  }
  if (preset === "lastMonth") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: isoDate(start), end: isoDate(end) };
  }
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
  const amount = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(amount) + " " + currencyCode;
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? value + "T00:00:00+07:00" : value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

function statusLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    completed: "Selesai",
    complete: "Selesai",
    paid: "Lunas",
    partially_paid: "Dibayar sebagian",
    unpaid: "Belum dibayar",
    pending: "Menunggu",
    draft: "Draft",
    cancelled: "Dibatalkan",
    canceled: "Dibatalkan",
    refunded: "Dikembalikan",
    received: "Diterima",
    partially_received: "Diterima sebagian",
    open: "Terbuka",
    recorded: "Tercatat",
    failed: "Gagal",
  };
  return labels[normalized] ?? (normalized ? normalized.replace(/_/g, " ") : "Tidak diketahui");
}

function periodLabel(start: string, end: string) {
  return start + " – " + end;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Laporan gagal dimuat.";
}

function SectionHeader({
  icon: Icon,
  title,
  description,
  count,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  count?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary dark:bg-primary/15">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[12px] font-bold leading-5 sm:text-[13px]">{title}</h2>
            {count ? <Badge variant="outline" className="h-5 rounded-full px-2 text-[9px]">{count}</Badge> : null}
          </div>
          {description ? <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-background/70 px-3 py-2.5">
      <p className="truncate text-[9px] font-medium text-muted-foreground sm:text-[10px]">{label}</p>
      <p className="mt-1 break-words text-[13px] font-bold leading-5 tabular-nums sm:text-sm">{value}</p>
      {detail ? <p className="mt-0.5 text-[9px] leading-3.5 text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function EmptyRows({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-[10px] leading-4 text-muted-foreground">
      {children}
    </div>
  );
}

function FinanceCurrencyCards({ report }: { report: FinanceExportReport }) {
  if (!report.currencySummaries.length) {
    return <div className={dashboardSurface + " " + dashboardPadding}><EmptyRows>Belum ada transaksi keuangan tercatat pada periode ini.</EmptyRows></div>;
  }

  return (
    <section className="grid gap-2.5 xl:grid-cols-2" aria-label="Ringkasan keuangan per mata uang">
      {report.currencySummaries.map((summary) => (
        <div key={summary.currency_code} className={dashboardSurface + " " + dashboardPadding}>
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Ringkasan keuangan</p>
              <p className="mt-0.5 text-sm font-bold">{summary.currency_code}</p>
            </div>
            <Badge variant="secondary" className="rounded-full text-[9px]">
              {summary.recorded_income_transaction_count + summary.recorded_expense_transaction_count} transaksi
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MetricTile label="Pemasukan tercatat" value={money(summary.recorded_income, summary.currency_code)} detail={summary.recorded_income_transaction_count + " transaksi"} />
            <MetricTile label="Pengeluaran tercatat" value={money(summary.recorded_expense, summary.currency_code)} detail={summary.recorded_expense_transaction_count + " transaksi"} />
            <MetricTile label="Net operasional" value={money(summary.net_operational_movement, summary.currency_code)} detail="Masuk dikurangi keluar" />
            <MetricTile label="Pendapatan penyewaan" value={money(summary.rental_income, summary.currency_code)} />
            <MetricTile label="Penjualan retail" value={money(summary.retail_income, summary.currency_code)} />
            <MetricTile label="Pembayaran tercatat" value={money(summary.recorded_payment_amount, summary.currency_code)} detail={summary.recorded_payment_count + " baris pembayaran; tidak ditambahkan kembali ke pemasukan"} />
          </div>
        </div>
      ))}
    </section>
  );
}

function FinanceActivity({ report }: { report: FinanceExportReport }) {
  const transactions = [...report.transactions]
    .sort((a, b) => b.tanggal_transaksi.localeCompare(a.tanggal_transaksi))
    .slice(0, 5);

  return (
    <section className="grid gap-2.5 xl:grid-cols-[1.15fr_.85fr]">
      <div className={dashboardSurface + " " + dashboardPadding}>
        <SectionHeader
          icon={Receipt}
          title="Transaksi Keuangan"
          description="Catatan pemasukan dan pengeluaran yang sudah tercatat."
          count={report.transactions.length + " data"}
          action={<Link to={paths.keuangan + "/transaksi"} className="shrink-0 text-[9px] font-semibold text-primary">Lihat semua <ChevronRight className="inline size-3" /></Link>}
        />
        <div className="mt-3 space-y-1">
          {transactions.length ? transactions.map((row) => (
            <Link
              key={row.transaksi_keuangan_id}
              to={paths.keuangan + "/transaksi/" + row.transaksi_keuangan_id}
              className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border/50 px-2.5 py-2.5 transition-colors hover:bg-muted/25"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted/70 text-muted-foreground">
                <Receipt className="size-3.5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold">{row.nomor_transaksi}</span>
                <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{formatFinanceKind(row.jenis)} · {formatFinanceSource(row.sumber_type)} · {formatDate(row.tanggal_transaksi)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[10px] font-bold tabular-nums">{money(Number(row.amount), row.currency_code)}</span>
                <span className="mt-0.5 block text-[8px] text-muted-foreground">{row.arah === "income" ? "Masuk" : "Keluar"}</span>
              </span>
            </Link>
          )) : <EmptyRows>Tidak ada transaksi pada periode ini.</EmptyRows>}
        </div>
        {report.transactions.length > 5 ? <p className="mt-2 text-[9px] text-muted-foreground">Menampilkan 5 transaksi terbaru. Ekspor memuat seluruh data periode.</p> : null}
      </div>

      <div className={dashboardSurface + " " + dashboardPadding}>
        <SectionHeader
          icon={Wallet}
          title="Pengeluaran per Kategori"
          description="Rekap pengeluaran tercatat, dikelompokkan per mata uang."
          count={report.expenseByCategoryCurrency.length + " kategori"}
        />
        <div className="mt-3 space-y-1">
          {report.expenseByCategoryCurrency.slice(0, 7).map((item) => (
            <div key={item.currency_code + "-" + item.key} className="flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 hover:bg-muted/25">
              <div className="min-w-0">
                <p className="truncate text-[10px] font-semibold">{item.key}</p>
                <p className="mt-0.5 text-[9px] text-muted-foreground">{item.count} transaksi · {item.currency_code}</p>
              </div>
              <span className="shrink-0 text-[10px] font-bold tabular-nums">{money(item.amount, item.currency_code)}</span>
            </div>
          ))}
          {!report.expenseByCategoryCurrency.length ? <EmptyRows>Tidak ada pengeluaran pada periode ini.</EmptyRows> : null}
        </div>
      </div>
    </section>
  );
}

function RetailAndPurchasing({ report }: { report: FinanceExportReport }) {
  const sales = [...report.retailSales].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  const purchases = [...report.purchases].sort((a, b) => b.tanggal_pembelian.localeCompare(a.tanggal_pembelian)).slice(0, 5);
  const soldQuantity = report.retailSales.reduce((total, sale) => total + sale.quantity, 0);
  const receivedQuantity = report.purchases.reduce((total, purchase) => total + purchase.received_quantity, 0);

  return (
    <section className="grid gap-2.5 xl:grid-cols-2">
      <div className={dashboardSurface + " " + dashboardPadding}>
        <SectionHeader
          icon={ShoppingBag}
          title="Penjualan Retail"
          description="Struk penjualan, status pembayaran, dan keterlacakan HPP."
          count={report.retailSales.length + " struk"}
          action={<Link to={paths.penjualan} className="shrink-0 text-[9px] font-semibold text-primary">Buka penjualan <ChevronRight className="inline size-3" /></Link>}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <MetricTile label="Struk penjualan" value={String(report.retailSales.length)} />
          <MetricTile label="Kuantitas terjual" value={soldQuantity.toLocaleString("id-ID")} detail="Akumulasi semua item" />
        </div>
        <div className="mt-2 space-y-1">
          {sales.length ? sales.map((sale) => (
            <div key={sale.penjualan_id} className="rounded-xl border border-border/50 px-2.5 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-bold">{sale.nomor_penjualan}</p>
                  <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{sale.nama_pelanggan || "Pelanggan umum"} · {formatDateTime(sale.created_at)}</p>
                </div>
                <Badge variant="outline" className="shrink-0 rounded-full text-[8px]">{statusLabel(sale.payment_status)}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px]">
                <span className="text-muted-foreground">{sale.item_count} jenis · {sale.quantity} unit · {sale.currency_code}</span>
                <span className="font-bold tabular-nums">{money(sale.total_amount, sale.currency_code)}</span>
              </div>
              {sale.hpp_unknown_lines > 0 ? (
                <p className="mt-1 text-[8px] text-amber-700 dark:text-amber-400">HPP belum lengkap pada {sale.hpp_unknown_lines} rincian.</p>
              ) : sale.gross_profit != null ? (
                <p className="mt-1 text-[8px] text-muted-foreground">Margin kotor tercatat: {money(sale.gross_profit, sale.currency_code)}</p>
              ) : null}
            </div>
          )) : <EmptyRows>Belum ada penjualan retail pada periode ini.</EmptyRows>}
        </div>
      </div>

      <div className={dashboardSurface + " " + dashboardPadding}>
        <SectionHeader
          icon={PackageCheck}
          title="Pembelian & Penerimaan"
          description="Dokumen pembelian dan jumlah stok yang sudah diterima."
          count={report.purchases.length + " dokumen"}
          action={<Link to={paths.pembelian} className="shrink-0 text-[9px] font-semibold text-primary">Buka pembelian <ChevronRight className="inline size-3" /></Link>}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <MetricTile label="Dokumen pembelian" value={String(report.purchases.length)} />
          <MetricTile label="Unit diterima" value={receivedQuantity.toLocaleString("id-ID")} detail="Dari bukti penerimaan" />
        </div>
        <div className="mt-2 space-y-1">
          {purchases.length ? purchases.map((purchase) => (
            <div key={purchase.pembelian_id} className="rounded-xl border border-border/50 px-2.5 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-bold">{purchase.nomor_pembelian}</p>
                  <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{purchase.nama_pemasok} · {formatDate(purchase.tanggal_pembelian)}</p>
                </div>
                <Badge variant="outline" className="shrink-0 rounded-full text-[8px]">{statusLabel(purchase.status)}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px]">
                <span className="text-muted-foreground">{purchase.item_count} jenis · {purchase.received_quantity} diterima</span>
                <span className="font-bold tabular-nums">{money(purchase.total_amount, purchase.currency_code)}</span>
              </div>
              <p className="mt-1 text-[8px] text-muted-foreground">
                Kas keluar tercatat: {money(purchase.cash_out_amount, purchase.currency_code)} · nilai stok diterima: {money(purchase.received_stock_value, purchase.currency_code)}
              </p>
            </div>
          )) : <EmptyRows>Belum ada dokumen pembelian pada periode ini.</EmptyRows>}
        </div>
      </div>
    </section>
  );
}

function PromotionUsage({ report }: { report: FinanceExportReport }) {
  const recent = [...report.promotionUsage].sort((a, b) => b.tanggal.localeCompare(a.tanggal)).slice(0, 6);
  const summary = useMemo(() => {
    const byCurrency = new Map<string, { count: number; discount: number; bonusHpp: number }>();
    for (const item of report.promotionUsage) {
      const current = byCurrency.get(item.mata_uang) ?? { count: 0, discount: 0, bonusHpp: 0 };
      current.count += 1;
      current.discount += Number(item.diskon) || 0;
      current.bonusHpp += Number(item.hpp_bonus) || 0;
      byCurrency.set(item.mata_uang, current);
    }
    return Array.from(byCurrency.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [report.promotionUsage]);

  return (
    <section className={dashboardSurface + " " + dashboardPadding}>
      <SectionHeader
        icon={Tag}
        title="Promo & Diskon Digunakan"
        description="Pemakaian aktual dari promo katalog, paket sewa, loyalitas, diskon manual, dan barang bonus."
        count={report.promotionUsage.length + " penggunaan"}
        action={<Link to={paths.eventPromotions} className="shrink-0 text-[9px] font-semibold text-primary">Kelola promo <ArrowUpRight className="inline size-3" /></Link>}
      />
      {summary.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {summary.map(([currency, value]) => (
            <div key={currency} className="rounded-xl border border-border/60 bg-background/70 p-2.5">
              <p className="text-[9px] font-bold text-muted-foreground">{currency} · {value.count} penggunaan</p>
              <p className="mt-1 text-sm font-bold tabular-nums">{money(value.discount, currency)}</p>
              <p className="mt-0.5 text-[8px] text-muted-foreground">Total diskon tercatat</p>
              {value.bonusHpp > 0 ? <p className="mt-1 text-[8px] text-muted-foreground">HPP barang bonus: {money(value.bonusHpp, currency)}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2 space-y-1">
        {recent.length ? recent.map((item, index) => (
          <div key={item.nomor_transaksi + "-" + item.jenis_promo + "-" + index} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-border/50 px-2.5 py-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/25 dark:text-amber-300">
              <Tag className="size-3.5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold">{item.jenis_promo}</span>
                <Badge variant="outline" className="rounded-full text-[8px]">{item.sumber}</Badge>
              </span>
              <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{item.nomor_transaksi} · {item.barang_paket} · {formatDateTime(item.tanggal)}</span>
              {item.catatan ? <span className="mt-0.5 block truncate text-[8px] text-muted-foreground">{item.catatan}</span> : null}
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[10px] font-bold tabular-nums">−{money(item.diskon, item.mata_uang)}</span>
              <span className="mt-0.5 block text-[8px] text-muted-foreground">Nilai akhir {money(item.nilai_akhir, item.mata_uang)}</span>
            </span>
          </div>
        )) : (
          <EmptyRows>
            Belum ada promo atau diskon yang diterapkan pada transaksi periode ini. Bagian ini menampilkan pemakaian aktual, bukan daftar promo yang sedang aktif.
          </EmptyRows>
        )}
      </div>
      {report.promotionUsage.length > 6 ? <p className="mt-2 text-[9px] text-muted-foreground">Menampilkan 6 penggunaan terbaru. Ekspor memuat seluruh rincian promo dan diskon.</p> : null}
    </section>
  );
}

function FinanceReportContent({ report }: { report: FinanceExportReport }) {
  return (
    <div className="space-y-3.5">
      <FinanceCurrencyCards report={report} />
      {report.hasMultipleCurrencies ? (
        <p className="rounded-xl border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-[9px] leading-4 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
          Laporan memuat beberapa mata uang. Setiap ringkasan dipisahkan per mata uang dan tidak dijumlahkan menjadi satu total.
        </p>
      ) : null}
      <FinanceActivity report={report} />
      <RetailAndPurchasing report={report} />
      <PromotionUsage report={report} />
      <p className="px-1 text-[9px] leading-4 text-muted-foreground">
        Sumber laporan: transaksi Finance, penjualan retail, pembelian, penerimaan stok, dan penggunaan promo. Pembayaran ditampilkan sebagai rincian pendukung, bukan ditambahkan kembali ke pemasukan.
      </p>
    </div>
  );
}

function RentalReportContent({ report }: { report: RentalExportReport }) {
  const items = [...report.items].sort((a, b) => b.jadwal_mulai.localeCompare(a.jadwal_mulai)).slice(0, 8);
  const payments = [...report.payments].sort((a, b) => b.dibayar_at.localeCompare(a.dibayar_at)).slice(0, 6);

  return (
    <div className="space-y-3.5">
      <div className={dashboardSurface + " " + dashboardPadding}>
        <SectionHeader
          icon={TentTree}
          title="Ringkasan Penyewaan"
          description={report.period.basis}
          count={report.summary.rental_count + " penyewaan"}
        />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricTile label="Penyewaan aktif" value={String(report.summary.active_count)} />
          <MetricTile label="Selesai" value={String(report.summary.completed_count)} />
          <MetricTile label="Draft" value={String(report.summary.draft_count)} />
          <MetricTile label="Dibatalkan" value={String(report.summary.cancelled_count)} />
        </div>
      </div>

      {report.currencySummaries.length ? (
        <section className="grid gap-2.5 xl:grid-cols-2" aria-label="Nilai penyewaan per mata uang">
          {report.currencySummaries.map((summary) => (
            <div key={summary.currency_code} className={dashboardSurface + " " + dashboardPadding}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-bold">{summary.currency_code}</p>
                <Badge variant="outline" className="rounded-full text-[9px]">{summary.rental_count} penyewaan</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MetricTile label="Nilai kontrak" value={money(summary.contractual_value, summary.currency_code)} />
                <MetricTile label="Pembayaran" value={money(summary.recorded_payment_total, summary.currency_code)} />
                <MetricTile label="Sisa tagihan" value={money(summary.balance_due_total, summary.currency_code)} />
                <MetricTile label="Estimasi denda aktif" value={money(summary.estimated_late_fee_total, summary.currency_code)} detail={money(summary.approved_late_fee_total, summary.currency_code) + " disetujui"} />
              </div>
              {summary.pending_late_fee_total > 0 ? <p className="mt-2 text-[9px] text-amber-700 dark:text-amber-400">Denda menunggu review: {money(summary.pending_late_fee_total, summary.currency_code)}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {report.hasMultipleCurrencies ? (
        <p className="rounded-xl border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-[9px] leading-4 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
          Nilai kontrak, pembayaran, dan sisa tagihan dikelompokkan per mata uang. Pembayaran dalam mata uang berbeda tidak mengurangi tagihan kontrak.
        </p>
      ) : null}

      <div className={dashboardSurface + " " + dashboardPadding}>
        <SectionHeader
          icon={TentTree}
          title="Daftar Penyewaan"
          description="Ringkasan kontrak, status, tagihan, dan denda."
          count={report.items.length + " data"}
          action={<Link to={paths.penyewaan} className="shrink-0 text-[9px] font-semibold text-primary">Buka penyewaan <ChevronRight className="inline size-3" /></Link>}
        />
        <div className="mt-2 space-y-1.5">
          {items.length ? items.map((item) => (
            <Link key={item.penyewaan_id} to={paths.penyewaan + "/" + item.penyewaan_id} className="block rounded-xl border border-border/50 px-2.5 py-2.5 transition-colors hover:bg-muted/25">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-[10px] font-bold">{item.nomor_penyewaan}</span>
                  <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{item.penyewa_nama ?? "Nama penyewa tidak tersedia"}</span>
                </span>
                <Badge variant="outline" className="shrink-0 rounded-full text-[8px]">{formatRentalStatus(item.status)}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[8px] text-muted-foreground">
                <span>{formatDate(item.jadwal_mulai)} – {formatDate(item.jadwal_kembali)}</span>
                <span>{item.currency_code}</span>
                {item.payment_currency_mismatch_count > 0 ? <span className="text-amber-700 dark:text-amber-400">Mata uang pembayaran berbeda</span> : null}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <MetricTile label="Nilai kontrak" value={money(Number(item.total_amount), item.currency_code)} />
                <MetricTile label="Sisa tagihan" value={money(item.balance_due, item.currency_code)} />
                <MetricTile label="Denda disetujui" value={money(item.approved_late_fee, item.currency_code)} />
              </div>
            </Link>
          )) : <EmptyRows>Tidak ada penyewaan pada periode ini.</EmptyRows>}
        </div>
        {report.items.length > 8 ? <p className="mt-2 text-[9px] text-muted-foreground">Menampilkan 8 penyewaan terakhir. Ekspor memuat seluruh data periode.</p> : null}
      </div>

      <div className={dashboardSurface + " " + dashboardPadding}>
        <SectionHeader
          icon={CircleDollarSign}
          title="Pembayaran Penyewaan"
          description="Riwayat pembayaran yang terkait dengan kontrak pada periode ini."
          count={report.payments.length + " pembayaran"}
        />
        <div className="mt-2 space-y-1">
          {payments.length ? payments.map((payment) => (
            <div key={payment.pembayaran_id} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border/50 px-2.5 py-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300">
                <CircleDollarSign className="size-3.5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold">{payment.nomor_pembayaran} · {payment.nomor_penyewaan}</span>
                <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{payment.nama_penyewa} · {payment.jenis} · {payment.metode} · {formatDateTime(payment.dibayar_at)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[10px] font-bold tabular-nums">{money(payment.amount, payment.currency_code)}</span>
                <span className="mt-0.5 block text-[8px] text-muted-foreground">{statusLabel(payment.status)}</span>
              </span>
            </div>
          )) : <EmptyRows>Belum ada pembayaran penyewaan pada periode ini.</EmptyRows>}
        </div>
        {report.payments.length > 6 ? <p className="mt-2 text-[9px] text-muted-foreground">Menampilkan 6 pembayaran terbaru. Ekspor memuat seluruh data terkait.</p> : null}
      </div>
    </div>
  );
}

export function LaporanPage() {
  const { current, status: usahaStatus, error: usahaError } = useCurrentUsaha();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeModule: ReportModule = searchParams.get("modul") === "penyewaan" ? "penyewaan" : "keuangan";
  const initial = useMemo(() => defaultPeriod(), []);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [preset, setPreset] = useState<PeriodPreset>("thisMonth");
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
  const isFinance = activeModule === "keuangan";

  const selectModule = (module: ReportModule) => {
    setSearchParams(module === "keuangan" ? {} : { modul: "penyewaan" });
  };

  const selectPreset = (nextPreset: Exclude<PeriodPreset, "custom">) => {
    const range = rangeForPreset(nextPreset);
    setPreset(nextPreset);
    setStart(range.start);
    setEnd(range.end);
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
        // Load operational details separately from the heavier finance reconciliation bundle.
        // This keeps the report screen complete without loading investor/health diagnostics.
        const result = await getFinanceExportReport(usahaId, start, endExclusive, false, true);
        if (sequence !== loadSequence.current) return;
        setFinanceReport(result);
      } else {
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
        const completeReport = await getFinanceExportReport(usahaId, start, endExclusive, true, true);
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

  const presets: Array<{ key: Exclude<PeriodPreset, "custom">; label: string }> = [
    { key: "today", label: "Hari ini" },
    { key: "last7", label: "7 hari" },
    { key: "thisMonth", label: "Bulan ini" },
    { key: "lastMonth", label: "Bulan lalu" },
  ];

  return (
    <div data-testid="reports-page" className="w-full space-y-3.5 pb-8 sm:space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Insight operasional</p>
          <h1 className="mt-0.5 text-[1.45rem] font-bold leading-tight tracking-[-0.03em] sm:text-2xl">Laporan</h1>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground sm:text-xs">
            Ringkasan usaha, transaksi, penjualan, pembelian, penyewaan, serta penggunaan promo.
          </p>
        </div>
        <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-2 text-[9px] font-semibold text-muted-foreground shadow-sm">
          <span className="grid size-5 place-items-center rounded-full bg-primary/10 text-primary"><BarChart3 className="size-3" /></span>
          <span className="max-w-[14rem] truncate text-foreground">{current?.usahaNama ?? "Usaha aktif"}</span>
        </div>
      </header>

      <section className={dashboardSurface + " " + dashboardPadding} aria-label="Filter periode laporan">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-muted text-muted-foreground"><CalendarDays className="size-3.5" /></span>
            <div>
              <p className="text-[10px] font-bold">Periode laporan</p>
              <p className="text-[9px] text-muted-foreground">{periodLabel(start, end)}</p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-[9px]" onClick={() => void load()} disabled={busy || invalidPeriod || !usahaId}>
            <RefreshCw className={"mr-1.5 size-3 " + (busy ? "animate-spin" : "")} />
            Segarkan
          </Button>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {presets.map((item) => (
            <Button
              key={item.key}
              type="button"
              size="sm"
              variant={preset === item.key ? "default" : "outline"}
              className="h-7 rounded-lg px-2.5 text-[9px]"
              aria-pressed={preset === item.key}
              onClick={() => selectPreset(item.key)}
            >
              {item.label}
            </Button>
          ))}
          <Badge variant={preset === "custom" ? "default" : "secondary"} className="h-7 rounded-lg px-2.5 text-[9px]">Kustom</Badge>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:items-end">
          <label className="grid min-w-0 gap-1 text-[9px] font-medium text-muted-foreground sm:w-40">
            Mulai
            <input
              aria-label="Tanggal mulai"
              className="h-9 min-w-0 rounded-lg border border-border/70 bg-background px-2.5 text-[10px] font-medium text-foreground"
              type="date"
              value={start}
              max={end}
              onChange={(event) => { setPreset("custom"); setStart(event.target.value); }}
            />
          </label>
          <label className="grid min-w-0 gap-1 text-[9px] font-medium text-muted-foreground sm:w-40">
            Selesai
            <input
              aria-label="Tanggal selesai"
              className="h-9 min-w-0 rounded-lg border border-border/70 bg-background px-2.5 text-[10px] font-medium text-foreground"
              type="date"
              value={end}
              min={start}
              onChange={(event) => { setPreset("custom"); setEnd(event.target.value); }}
            />
          </label>
          <span className="hidden pb-2 text-[9px] text-muted-foreground sm:inline">Data mengikuti zona waktu usaha.</span>
        </div>
      </section>

      <section className={dashboardSurface + " flex flex-col gap-2 p-2 sm:flex-row sm:items-center sm:justify-between"} aria-label="Jenis laporan">
        <div role="tablist" aria-label="Modul laporan" className="grid grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1 sm:w-[min(100%,22rem)]">
          <button
            type="button"
            role="tab"
            aria-selected={isFinance}
            className={"flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[10px] font-semibold transition-colors " + (isFinance ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            onClick={() => selectModule("keuangan")}
          >
            <Wallet className="size-3.5" /> Keuangan
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isFinance}
            className={"flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[10px] font-semibold transition-colors " + (!isFinance ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            onClick={() => selectModule("penyewaan")}
          >
            <TentTree className="size-3.5" /> Penyewaan
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:flex">
          <Button type="button" variant="outline" size="sm" className="h-9 rounded-lg px-3 text-[9px]" onClick={() => void exportReport("excel")} disabled={busy || Boolean(exportBusy) || invalidPeriod || !usahaId}>
            {exportBusy === "excel" ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <FileSpreadsheet className="mr-1.5 size-3.5" />}
            Excel
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-9 rounded-lg px-3 text-[9px]" onClick={() => void exportReport("pdf")} disabled={busy || Boolean(exportBusy) || invalidPeriod || !usahaId}>
            {exportBusy === "pdf" ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <FileText className="mr-1.5 size-3.5" />}
            PDF
          </Button>
        </div>
      </section>

      {invalidPeriod ? <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[10px] text-destructive">Tanggal mulai wajib lebih awal atau sama dengan tanggal selesai.</div> : null}
      {!current && usahaStatus === "error" ? <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[10px] text-destructive">{usahaError?.message ?? "Usaha aktif tidak dapat diverifikasi."}</div> : null}
      {error ? (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[10px] text-destructive">
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 rounded-lg text-[9px]" onClick={() => void load()}>Coba lagi</Button>
        </div>
      ) : null}
      {exportError ? <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[10px] text-destructive">{exportError}</div> : null}

      {busy ? (
        <div className={dashboardSurface + " flex min-h-28 items-center justify-center gap-2 " + dashboardPadding}>
          <Loader2 className="size-4 animate-spin text-primary" />
          <span className="text-[10px] text-muted-foreground">Memuat laporan {isFinance ? "keuangan" : "penyewaan"}…</span>
        </div>
      ) : null}

      {!busy && !error && isFinance && financeReport ? <FinanceReportContent report={financeReport} /> : null}
      {!busy && !error && !isFinance && rentalReport ? <RentalReportContent report={rentalReport} /> : null}

      {!busy && current && !error && ((isFinance && !financeReport) || (!isFinance && !rentalReport)) ? (
        <div className={dashboardSurface + " " + dashboardPadding}>
          <EmptyRows><Download className="mx-auto mb-2 size-5" />Laporan belum memiliki data untuk periode ini.</EmptyRows>
        </div>
      ) : null}
    </div>
  );
}

LaporanPage.displayName = "LaporanPage";
