import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  Package,
  ReceiptText,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { type ReactNode } from "react";
import { Link } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { FinancePeriodCompact, FinanceShell } from "@/components/keuangan/finance-ui";
import {
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceMoney,
  formatFinancePeriodLabel,
  getKeuanganContext,
  getFinanceRetailAnalysis,
  semanticFinanceLabel,
  useFinancePeriod,
  useFinanceRealtime,
} from "@/features/keuangan";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Analisis retail gagal dimuat.";
}

function quantityLabel(value: number | null, unit?: string | null) {
  if (value === null) return "Tidak dilacak";
  const formatted = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value);
  return unit ? formatted + " " + unit : formatted;
}

function inventoryModeLabel(value: string) {
  if (value === "serialized") return "Unit satuan";
  if (value === "quantity") return "Stok kuantitas";
  if (value === "untracked") return "Tanpa pelacakan stok";
  return semanticFinanceLabel(value);
}

function purchaseStatusLabel(value: string) {
  if (value === "completed") return "Selesai";
  if (value === "draft") return "Draft";
  if (value === "cancelled" || value === "voided") return "Dibatalkan";
  return semanticFinanceLabel(value);
}

function MetricCard({
  label,
  value,
  note,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "neutral" | "green" | "blue" | "amber";
  icon: ReactNode;
}) {
  const tones = {
    neutral: "border-border/60 bg-card",
    green: "border-emerald-100 bg-emerald-50/55 dark:border-emerald-900/35 dark:bg-emerald-950/10",
    blue: "border-sky-100 bg-sky-50/55 dark:border-sky-900/35 dark:bg-sky-950/10",
    amber: "border-amber-100 bg-amber-50/55 dark:border-amber-900/35 dark:bg-amber-950/10",
  };
  return (
    <Card className={tones[tone] + " shadow-none"}>
      <CardContent className="flex min-w-0 items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="text-[9px] font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-[15px] font-bold tracking-tight tabular-nums">{value}</p>
          <p className="mt-1 text-[8px] leading-3 text-muted-foreground">{note}</p>
        </div>
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-background/75 text-primary">{icon}</span>
      </CardContent>
    </Card>
  );
}

export function FinanceRetailAnalysis() {
  useFinanceRealtime();
  const context = useQuery({
    queryKey: ["keuangan", "context"],
    queryFn: getKeuanganContext,
    staleTime: 60_000,
  });
  const periodState = useFinancePeriod(context.data?.timezone ?? "Asia/Jakarta");
  const query = useQuery({
    queryKey: [
      "keuangan",
      "retail-analysis",
      context.data?.usahaId,
      periodState.period.startDate,
      periodState.period.endDateExclusive,
    ],
    queryFn: () => getFinanceRetailAnalysis(
      context.data!.usahaId,
      periodState.period.startDate,
      periodState.period.endDateExclusive,
    ),
    enabled: Boolean(context.data?.usahaId) && periodState.period.valid !== false,
    staleTime: 30_000,
  });

  if (context.isPending) {
    return (
      <FinanceShell variant="home" title="Analisis Retail">
        <div className="h-36 animate-pulse rounded-[24px] bg-muted" />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      </FinanceShell>
    );
  }

  if (context.error || !context.data) {
    return (
      <FinanceShell variant="home" title="Analisis Retail">
        <Alert variant="destructive">
          <AlertTitle>Analisis retail belum dapat dibuka</AlertTitle>
          <AlertDescription>{errorMessage(context.error)}</AlertDescription>
        </Alert>
      </FinanceShell>
    );
  }

  if (periodState.period.valid === false) {
    return (
      <FinanceShell variant="home" title="Analisis Retail">
        <Alert variant="destructive">
          <AlertTitle>Rentang tanggal tidak valid</AlertTitle>
          <AlertDescription>{periodState.period.validationMessage ?? "Pastikan tanggal mulai tidak melewati tanggal selesai."}</AlertDescription>
        </Alert>
        <FinancePeriodCompact
          timezone={context.data.timezone}
          selection={periodState.period}
          onPreset={periodState.setPreset}
          onCustomStart={periodState.setCustomStart}
          onCustomEnd={periodState.setCustomEnd}
        />
      </FinanceShell>
    );
  }

  if (query.isPending) {
    return (
      <FinanceShell variant="home" title="Analisis Retail">
        <div className="h-36 animate-pulse rounded-[24px] bg-muted" />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      </FinanceShell>
    );
  }

  if (query.error || !query.data) {
    return (
      <FinanceShell variant="home" title="Analisis Retail">
        <Alert variant="destructive">
          <AlertTitle>Data analisis retail belum tersedia</AlertTitle>
          <AlertDescription>{errorMessage(query.error)}</AlertDescription>
        </Alert>
      </FinanceShell>
    );
  }

  const data = query.data;
  const summary = data.summary;
  const coverage = summary.hpp_coverage_pct === null ? null : Math.min(100, Math.max(0, summary.hpp_coverage_pct));

  return (
    <FinanceShell variant="home" title="Analisis Retail">
      <section className="relative isolate overflow-hidden rounded-[24px] border border-white/70 shadow-[0_10px_34px_rgba(24,70,56,.10)]">
        <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/login-bg.webp')" }} />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[#075645]/78 via-[#0f5b4a]/42 to-black/20" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/28 to-transparent" />
        <div className="relative px-4 pb-4 pt-4 text-white sm:px-6 sm:pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/88 text-[#0b5d4a] shadow-sm backdrop-blur">
              <ShoppingBag className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/80">Keuangan · Retail</p>
              <h1 className="mt-1 text-[27px] font-bold leading-8 tracking-[-0.035em] sm:text-4xl">Analisis Retail</h1>
              <p className="mt-1 max-w-xl text-[10px] leading-5 text-white/90 sm:text-sm">
                Omzet, HPP, laba kotor terhitung, pembelian, dan stok dalam satu tampilan.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-white/25 bg-white/12 px-2.5 py-1 text-[9px] font-semibold backdrop-blur">
              {context.data.usahaNama}
            </span>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-2">
        <Link to={paths.keuangan} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-xl px-2 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/5">
          <ArrowRight className="size-3.5 rotate-180" /> Keuangan
        </Link>
        <div className="min-w-0 flex-1 text-right">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Periode laporan</p>
          <p className="truncate text-[11px] font-semibold">
            {formatFinancePeriodLabel(data.start_date, data.end_date_exclusive, data.timezone)}
          </p>
        </div>
        <FinancePeriodCompact
          timezone={context.data.timezone}
          selection={periodState.period}
          onPreset={periodState.setPreset}
          onCustomStart={periodState.setCustomStart}
          onCustomEnd={periodState.setCustomEnd}
        />
      </div>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricCard label="Omzet penjualan" value={formatFinanceMoney(summary.sales_revenue)} note={summary.sales_count + " transaksi selesai"} tone="green" icon={<ArrowUpRight className="size-3.5" />} />
        <MetricCard label="HPP terhitung" value={formatFinanceMoney(summary.known_hpp)} note="Dari baris penjualan dengan HPP" tone="amber" icon={<Boxes className="size-3.5" />} />
        <MetricCard label="Laba kotor terhitung" value={formatFinanceMoney(summary.gross_profit_known)} note="Hanya HPP tersedia; belum dikurangi biaya operasional" tone="blue" icon={<TrendingUp className="size-3.5" />} />
        <MetricCard label="Pembayaran diterima" value={formatFinanceMoney(summary.payment_received)} note={summary.payment_count + " pembayaran tercatat"} icon={<Banknote className="size-3.5" />} />
      </section>

      <Card className="rounded-2xl border-border/60 shadow-none">
        <CardContent className="space-y-3 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-bold">Kelengkapan HPP</p>
              <p className="mt-0.5 text-[9px] text-muted-foreground">Cakupan HPP dibanding omzet baris penjualan.</p>
            </div>
            <span className="text-[14px] font-bold tabular-nums">{coverage === null ? "—" : coverage.toLocaleString("id-ID", { maximumFractionDigits: 1 }) + "%"}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{ width: String(coverage ?? 0) + "%" }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-muted/35 px-3 py-2">
              <p className="text-[8px] text-muted-foreground">Omzet dengan HPP</p>
              <p className="mt-0.5 text-[11px] font-bold tabular-nums">{formatFinanceMoney(summary.sales_revenue - summary.hpp_unknown_revenue)}</p>
            </div>
            <div className="rounded-xl bg-amber-50/70 px-3 py-2 dark:bg-amber-950/15">
              <p className="text-[8px] text-muted-foreground">Omzet tanpa HPP</p>
              <p className="mt-0.5 text-[11px] font-bold tabular-nums">{formatFinanceMoney(summary.hpp_unknown_revenue)}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 px-2.5 py-2 dark:border-emerald-900/30 dark:bg-emerald-950/10">
              <p className="text-[8px] text-muted-foreground">Barang bonus</p>
              <p className="mt-0.5 text-[11px] font-bold tabular-nums">{quantityLabel(summary.promotion_bonus_quantity)}</p>
            </div>
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 px-2.5 py-2 dark:border-amber-900/30 dark:bg-amber-950/10">
              <p className="text-[8px] text-muted-foreground">HPP bonus</p>
              <p className="mt-0.5 text-[10px] font-bold tabular-nums">{formatFinanceMoney(summary.promotion_bonus_cost)}</p>
            </div>
            <div className="rounded-xl border px-2.5 py-2">
              <p className="text-[8px] text-muted-foreground">HPP bonus kosong</p>
              <p className="mt-0.5 text-[11px] font-bold tabular-nums">{summary.promotion_bonus_hpp_unknown_lines}</p>
            </div>
          </div>
          {summary.hpp_unknown_lines > 0 ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2.5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/15 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <p className="text-[9px] leading-4">
                {summary.hpp_unknown_lines} baris penjualan belum memiliki HPP, tersebar pada {summary.sales_with_incomplete_hpp} transaksi. Laba kotor di atas hanya menghitung baris dengan HPP yang tersedia.
              </p>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-[9px] text-emerald-700 dark:text-emerald-300">
              <ArrowUpRight className="size-3.5" /> Seluruh baris penjualan pada periode ini memiliki HPP.
            </p>
          )}
        </CardContent>
      </Card>

      <section className="grid grid-cols-3 gap-2">
        <Card className="border-amber-100 bg-amber-50/50 shadow-none dark:border-amber-900/30 dark:bg-amber-950/10">
          <CardContent className="p-3">
            <p className="text-[8px] text-muted-foreground">Pembelian selesai</p>
            <p className="mt-1 text-[14px] font-bold tabular-nums">{summary.completed_purchase_count}</p>
            <p className="mt-0.5 text-[8px] text-muted-foreground">{formatFinanceMoney(summary.completed_purchase_value)}</p>
          </CardContent>
        </Card>
        <Card className="border-rose-100 bg-rose-50/50 shadow-none dark:border-rose-900/30 dark:bg-rose-950/10">
          <CardContent className="p-3">
            <p className="text-[8px] text-muted-foreground">Kas keluar pembelian</p>
            <p className="mt-1 text-[12px] font-bold tabular-nums">{formatFinanceMoney(summary.purchase_cash_out)}</p>
            <p className="mt-0.5 text-[8px] text-muted-foreground">Mutasi uang tercatat</p>
          </CardContent>
        </Card>
        <Card className="border-sky-100 bg-sky-50/50 shadow-none dark:border-sky-900/30 dark:bg-sky-950/10">
          <CardContent className="p-3">
            <p className="text-[8px] text-muted-foreground">Barang diterima</p>
            <p className="mt-1 text-[14px] font-bold tabular-nums">{quantityLabel(summary.received_quantity)}</p>
            <p className="mt-0.5 text-[8px] text-muted-foreground">{formatFinanceMoney(summary.received_stock_value)}</p>
          </CardContent>
        </Card>
      </section>

      <section className="rounded-[22px] border border-border/60 bg-card p-3.5 shadow-[0_4px_16px_rgba(30,68,57,.04)]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2"><Package className="size-4 text-primary" /><h2 className="text-[12px] font-bold">Kinerja Barang & Varian</h2></div>
          <span className="text-[9px] text-muted-foreground">{data.top_products.length} item</span>
        </div>
        {data.top_products.length ? (
          <div className="mt-3 divide-y divide-border/60">
            {data.top_products.map((item) => (
              <div key={item.barang_id + ":" + (item.varian_barang_id ?? "base")} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-semibold">{item.nama_barang}</p>
                  {item.nama_varian ? <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{item.nama_varian}</p> : null}
                  <p className="mt-1 text-[8px] text-muted-foreground">
                    {quantityLabel(item.quantity_sold)} terjual · {item.sale_count} transaksi · {inventoryModeLabel(item.inventory_mode)}
                  </p>
                  {item.hpp_unknown_lines > 0 ? <p className="mt-1 text-[8px] text-amber-700 dark:text-amber-300">HPP belum lengkap pada {item.hpp_unknown_lines} baris</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-bold tabular-nums">{formatFinanceMoney(item.revenue)}</p>
                  <p className="mt-0.5 text-[8px] text-emerald-700 dark:text-emerald-300">Laba: {formatFinanceMoney(item.gross_profit_known)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="mt-3 rounded-xl bg-muted/30 px-3 py-4 text-center text-[9px] text-muted-foreground">Belum ada penjualan retail selesai pada periode ini.</p>}
      </section>

      <section className="rounded-[22px] border border-border/60 bg-card p-3.5 shadow-[0_4px_16px_rgba(30,68,57,.04)]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2"><Boxes className="size-4 text-primary" /><h2 className="text-[12px] font-bold">Posisi Stok Saat Ini</h2></div>
          <span className="text-[9px] text-muted-foreground">{data.stock_snapshot.length} barang/varian</span>
        </div>
        <div className="mt-3 divide-y divide-border/60">
          {data.stock_snapshot.length ? data.stock_snapshot.map((item) => (
            <div key={item.barang_id + ":" + (item.varian_barang_id ?? "base")} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-semibold">{item.nama_barang}{item.nama_varian ? " · " + item.nama_varian : ""}</p>
                <p className="mt-0.5 truncate text-[8px] text-muted-foreground">{item.kategori_nama ?? "Tanpa kategori"} · {inventoryModeLabel(item.inventory_mode)}</p>
                {item.unknown_cost_quantity > 0 ? <p className="mt-0.5 text-[8px] text-amber-700 dark:text-amber-300">{quantityLabel(item.unknown_cost_quantity)} belum memiliki biaya perolehan</p> : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-bold tabular-nums">{quantityLabel(item.stock_quantity, item.satuan_jual)}</p>
                {item.inventory_mode === "untracked" ? (
                  <p className="mt-0.5 text-[8px] text-muted-foreground">Stok tidak dihitung</p>
                ) : (
                  <p className="mt-0.5 text-[8px] text-muted-foreground">Nilai perolehan tercatat {formatFinanceMoney(item.known_cost_value)}</p>
                )}
              </div>
            </div>
          )) : <p className="rounded-xl bg-muted/30 px-3 py-4 text-center text-[9px] text-muted-foreground">Belum ada barang jual aktif.</p>}
        </div>
        <p className="mt-3 text-[8px] leading-4 text-muted-foreground">Nilai di atas adalah biaya perolehan yang tersedia, bukan estimasi harga pasar. Stok tanpa pelacakan tidak diberi jumlah atau nilai persediaan.</p>
      </section>

      <section className="rounded-[22px] border border-border/60 bg-card p-3.5 shadow-[0_4px_16px_rgba(30,68,57,.04)]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2"><ReceiptText className="size-4 text-primary" /><h2 className="text-[12px] font-bold">Riwayat Pembelian & Penerimaan</h2></div>
          <span className="text-[9px] text-muted-foreground">{data.purchase_history.length} dokumen</span>
        </div>
        {data.purchase_history.length ? (
          <div className="mt-3 divide-y divide-border/60">
            {data.purchase_history.map((item) => (
              <div key={item.pembelian_id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold">{item.nomor_pembelian}</p>
                    <p className="mt-0.5 truncate text-[8px] text-muted-foreground">{item.nama_pemasok} · {formatFinanceDate(item.tanggal_pembelian, data.timezone)}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted/50 px-2 py-0.5 text-[8px] font-semibold">{purchaseStatusLabel(item.status)}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div><p className="text-[8px] text-muted-foreground">Nilai dokumen</p><p className="mt-0.5 text-[9px] font-semibold tabular-nums">{formatFinanceMoney(item.total_amount, item.currency_code)}</p></div>
                  <div><p className="text-[8px] text-muted-foreground">Diterima</p><p className="mt-0.5 text-[9px] font-semibold tabular-nums">{quantityLabel(item.received_quantity)}</p></div>
                  <div><p className="text-[8px] text-muted-foreground">Kas keluar</p><p className="mt-0.5 text-[9px] font-semibold tabular-nums">{formatFinanceMoney(item.cash_out_amount, item.currency_code)}</p></div>
                </div>
                <p className="mt-1.5 text-[8px] text-muted-foreground">{item.receiving_count} penerimaan · nilai barang diterima {formatFinanceMoney(item.received_stock_value, item.currency_code)}</p>
              </div>
            ))}
          </div>
        ) : <p className="mt-3 rounded-xl bg-muted/30 px-3 py-4 text-center text-[9px] text-muted-foreground">Belum ada dokumen pembelian pada periode ini.</p>}
      </section>

      <section className="rounded-[22px] border border-border/60 bg-card p-3.5 shadow-[0_4px_16px_rgba(30,68,57,.04)]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2"><ShoppingBag className="size-4 text-primary" /><h2 className="text-[12px] font-bold">Penjualan Terbaru</h2></div>
          <Link to={paths.penjualan} className="inline-flex items-center gap-1 text-[9px] font-semibold text-primary">POS <ArrowRight className="size-3" /></Link>
        </div>
        {data.recent_sales.length ? (
          <div className="mt-3 divide-y divide-border/60">
            {data.recent_sales.map((sale) => (
              <div key={sale.penjualan_id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-semibold">{sale.nomor_penjualan}</p>
                  <p className="mt-0.5 truncate text-[8px] text-muted-foreground">{sale.nama_pelanggan || "Pelanggan umum"} · {formatFinanceDateTime(sale.created_at, data.timezone)} · {quantityLabel(sale.sold_quantity)} terjual</p>
                  {sale.hpp_unknown_lines > 0 ? <p className="mt-1 text-[8px] text-amber-700 dark:text-amber-300">{sale.hpp_unknown_lines} baris tanpa HPP</p> : null}
                  {sale.bonus_quantity > 0 ? <p className="mt-1 text-[8px] text-emerald-700 dark:text-emerald-300">{quantityLabel(sale.bonus_quantity)} barang bonus · HPP {formatFinanceMoney(sale.bonus_hpp_cost, sale.currency_code)}{sale.bonus_hpp_unknown_lines > 0 ? " · " + sale.bonus_hpp_unknown_lines + " HPP belum diketahui" : ""}</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-bold tabular-nums">{formatFinanceMoney(sale.total_amount, sale.currency_code)}</p>
                  <p className="mt-0.5 text-[8px] text-emerald-700 dark:text-emerald-300">Laba terhitung {formatFinanceMoney(sale.gross_profit_known, sale.currency_code)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="mt-3 rounded-xl bg-muted/30 px-3 py-4 text-center text-[9px] text-muted-foreground">Belum ada penjualan selesai pada periode ini.</p>}
      </section>

      <div className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50/65 px-3 py-2.5 dark:border-sky-900/30 dark:bg-sky-950/10">
        <ArrowDownRight className="mt-0.5 size-3.5 shrink-0 text-sky-700 dark:text-sky-300" />
        <p className="text-[8px] leading-4 text-muted-foreground">
          Pembelian mengurangi kas saat dibayar dan menambah biaya perolehan stok. HPP baru mengurangi laba kotor saat barang terjual; angka pembelian dan HPP tidak dijumlahkan dua kali sebagai kas keluar.
        </p>
      </div>
    </FinanceShell>
  );
}
