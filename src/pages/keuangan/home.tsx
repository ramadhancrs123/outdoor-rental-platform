import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarRange, CreditCard, ReceiptText, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  AmountDisplay,
  FinanceAttributionCard,
  FinanceHealthCard,
  FinanceMetric,
  FinanceNavNote,
  FinancePeriodBar,
  FinanceShell,
} from "@/components/keuangan/finance-ui";
import {
  getFinanceExpenseAnalysis,
  getFinanceHealth,
  getFinanceProductRevenue,
  getFinanceReconciliationFindings,
  getFinanceSummary,
  getFinanceUnitRevenue,
  getKeuanganContext,
} from "@/features/keuangan";
import {
  formatFinanceMoney,
  formatFinancePeriodLabel,
  getFinancePeriodSelection,
  formatFinanceTimezone,
} from "@/features/keuangan";
import type { FinancePeriodPreset } from "@/features/keuangan";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Data keuangan gagal dimuat.";
}

export function FinanceHome() {
  const [preset, setPreset] = useState<FinancePeriodPreset>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const context = useQuery({
    queryKey: ["keuangan", "context"],
    queryFn: getKeuanganContext,
    staleTime: 60_000,
  });

  const period = useMemo(
    () =>
      getFinancePeriodSelection(
        context.data?.timezone ?? "Asia/Jakarta",
        preset,
        customStart,
        customEnd,
      ),
    [context.data?.timezone, customEnd, customStart, preset],
  );

  const summary = useQuery({
    queryKey: ["keuangan", "summary", context.data?.usahaId, period],
    queryFn: () =>
      getFinanceSummary(context.data!.usahaId, period.startDate, period.endDateExclusive),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  const expenseAnalysis = useQuery({
    queryKey: ["keuangan", "expense-analysis", context.data?.usahaId, period],
    queryFn: () =>
      getFinanceExpenseAnalysis(context.data!.usahaId, period.startDate, period.endDateExclusive),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  const productRevenue = useQuery({
    queryKey: ["keuangan", "product-revenue", context.data?.usahaId, period],
    queryFn: () =>
      getFinanceProductRevenue(context.data!.usahaId, period.startDate, period.endDateExclusive),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  const unitRevenue = useQuery({
    queryKey: ["keuangan", "unit-revenue", context.data?.usahaId, period],
    queryFn: () =>
      getFinanceUnitRevenue(context.data!.usahaId, period.startDate, period.endDateExclusive),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  const health = useQuery({
    queryKey: ["keuangan", "health", context.data?.usahaId],
    queryFn: () => getFinanceHealth(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  const findings = useQuery({
    queryKey: ["keuangan", "findings", context.data?.usahaId],
    queryFn: () => getFinanceReconciliationFindings(context.data!.usahaId, 8),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  if (context.isPending) {
    return (
      <FinanceShell title="Keuangan" subtitle="Memuat konteks Usaha dan timezone bisnis.">
        <Card>
          <CardContent className="min-h-64 animate-pulse" />
        </Card>
      </FinanceShell>
    );
  }

  if (context.error || !context.data) {
    return (
      <FinanceShell title="Keuangan" subtitle="Ringkasan fakta keuangan usaha Anda.">
        <Alert variant="destructive">
          <AlertTitle>Keuangan belum dapat dibuka</AlertTitle>
          <AlertDescription>{errorMessage(context.error)}</AlertDescription>
        </Alert>
      </FinanceShell>
    );
  }

  const dataError =
    summary.error ??
    expenseAnalysis.error ??
    productRevenue.error ??
    unitRevenue.error ??
    health.error ??
    findings.error;

  if (summary.isPending) {
    return (
      <FinanceShell title="Keuangan" subtitle="Mengambil Money Truth dari server.">
        <Card>
          <CardContent className="min-h-72 animate-pulse" />
        </Card>
      </FinanceShell>
    );
  }

  if (dataError || !summary.data) {
    return (
      <FinanceShell title="Keuangan" subtitle="Ringkasan fakta keuangan usaha Anda.">
        <Alert variant="destructive">
          <AlertTitle>Read model keuangan belum dapat dibaca</AlertTitle>
          <AlertDescription>{errorMessage(dataError)}</AlertDescription>
        </Alert>
      </FinanceShell>
    );
  }

  const serverPeriod = {
    startDate: summary.data.start_date,
    endDateExclusive: summary.data.end_date_exclusive,
    timezone: summary.data.timezone,
  };

  return (
    <FinanceShell
      title="Keuangan"
      subtitle={
        <>
          Money Truth berasal dari server. Periode menggunakan <strong className="font-semibold text-foreground">business date</strong> pada timezone Usaha.
        </>
      }
      action={
        <div className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          Usaha: <span className="font-semibold text-foreground">{context.data.usahaNama}</span>
        </div>
      }
    >
      <FinancePeriodBar
        timezone={formatFinanceTimezone(context.data.timezone)}
        selection={period}
        onPreset={setPreset}
        onCustomStart={(value) => {
          setCustomStart(value);
          setPreset("custom");
        }}
        onCustomEnd={(value) => {
          setCustomEnd(value);
          setPreset("custom");
        }}
        serverPeriod={serverPeriod}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="overflow-hidden border-emerald-100 bg-emerald-50/55 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/15">
          <CardContent className="p-5">
            <AmountDisplay amount={summary.data.recorded_income} label="Pendapatan Tercatat" direction="income" />
            <p className="mt-3 text-xs text-muted-foreground">
              {summary.data.recorded_income_transaction_count} transaksi valid pada periode.
            </p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden border-rose-100 bg-rose-50/55 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/15">
          <CardContent className="p-5">
            <AmountDisplay amount={summary.data.recorded_expense} label="Pengeluaran Tercatat" direction="expense" />
            <p className="mt-3 text-xs text-muted-foreground">
              {summary.data.recorded_expense_transaction_count} transaksi valid pada periode.
            </p>
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-primary/[0.035] shadow-sm">
          <CardContent className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              Pergerakan Operasional Bersih
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {formatFinanceMoney(summary.data.net_operational_movement)}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Pendapatan Tercatat − Pengeluaran Tercatat. Bukan saldo kas dan bukan laba.
            </p>
          </CardContent>
        </Card>
        <FinanceMetric
          label="Pembayaran Tercatat"
          value={summary.data.recorded_payment_count}
          icon={CreditCard}
          tone="info"
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link to={paths.keuangan + "/pembayaran"} className="group">
          <Card className="h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="grid size-11 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300">
                <CreditCard className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Pembayaran</p>
                <p className="mt-1 text-xs text-muted-foreground">Telusuri data pembayaran.</p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </CardContent>
          </Card>
        </Link>
        <Link to={paths.keuangan + "/pengeluaran"} className="group">
          <Card className="h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="grid size-11 place-items-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-950/35 dark:text-rose-300">
                <ReceiptText className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Pengeluaran</p>
                <p className="mt-1 text-xs text-muted-foreground">Telusuri expense facts.</p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </CardContent>
          </Card>
        </Link>
        <Link to={paths.keuangan + "/transaksi"} className="group">
          <Card className="h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="grid size-11 place-items-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950/35 dark:text-sky-300">
                <WalletCards className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Transaksi Keuangan</p>
                <p className="mt-1 text-xs text-muted-foreground">Source financial facts.</p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardContent className="flex h-full flex-col justify-between p-5">
            <div>
              <p className="text-sm font-semibold">Periode aktif</p>
              <p className="mt-2 text-sm font-medium">
                {formatFinancePeriodLabel(summary.data.start_date, summary.data.end_date_exclusive, summary.data.timezone)}
              </p>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{formatFinanceTimezone(summary.data.timezone)}</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        {health.data ? (
          <FinanceHealthCard
            status={health.data.status}
            critical={health.data.critical}
            attention={health.data.attention}
            principle={health.data.principle}
          />
        ) : (
          <Card><CardContent className="p-5 text-sm text-muted-foreground">Status Keuangan belum tersedia.</CardContent></Card>
        )}
        <Card className="shadow-sm">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
                <CalendarRange className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Temuan rekonsiliasi</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Temuan dibuat server. Pending outbox adalah attention; anomaly integrity adalah critical.
                </p>
              </div>
            </div>
            {findings.data?.items.length ? (
              <div className="space-y-2">
                {findings.data.items.slice(0, 4).map((finding, index) => (
                  <div key={finding.code + "-" + index} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold">{finding.code}</p>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {finding.severity}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                Tidak ada finding yang dikembalikan server.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        {productRevenue.data ? (
          <FinanceAttributionCard
            title="Pendapatan per Produk / Kontribusi Pendapatan"
            exactAmount={productRevenue.data.exact_attributable_income}
            unallocatedAmount={productRevenue.data.unallocated_income}
            coverageRatio={productRevenue.data.coverage_ratio}
            allocationPolicy={productRevenue.data.allocation_policy}
          />
        ) : (
          <Card><CardContent className="p-5 text-sm text-muted-foreground">Analisis produk belum tersedia.</CardContent></Card>
        )}
        {unitRevenue.data ? (
          <FinanceAttributionCard
            title="Pendapatan per Unit — exact attribution only"
            exactAmount={unitRevenue.data.exact_unit_attributable_income}
            unallocatedAmount={unitRevenue.data.unallocated_or_ambiguous_income}
            coverageRatio={unitRevenue.data.coverage_ratio}
            allocationPolicy={unitRevenue.data.allocation_policy}
          />
        ) : (
          <Card><CardContent className="p-5 text-sm text-muted-foreground">Analisis unit belum tersedia.</CardContent></Card>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_.8fr]">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground"><ReceiptText className="size-5" /></div>
              <div><h2 className="text-base font-semibold">Pengeluaran per sumber</h2><p className="mt-1 text-xs text-muted-foreground">Nilai berasal langsung dari finance expense analysis.</p></div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {(expenseAnalysis.data?.by_source ?? []).map((item) => (
                <div key={item.source_type ?? "unknown"} className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">{item.source_type ?? "Tanpa source"}</p>
                  <p className="mt-1 font-semibold">{formatFinanceMoney(item.amount)}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{item.count} transaksi</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm font-semibold">Batas semantic</p>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Pendapatan Tercatat</strong> bukan formal accounting revenue.</p>
              <p><strong className="text-foreground">Pergerakan Operasional Bersih</strong> bukan saldo kas atau laba.</p>
              <p><strong className="text-foreground">Exact attribution</strong> tidak boleh diproporsikan ketika source ambigu.</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <FinanceNavNote>
        {summary.data.source_note} · {formatFinanceTimezone(summary.data.timezone)}
      </FinanceNavNote>
    </FinanceShell>
  );
}

FinanceHome.displayName = "FinanceHome";
