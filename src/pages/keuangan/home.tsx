import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronDown,
  CreditCard,
  FileText,
  Plus,
  ReceiptText,
  Settings2,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FinanceShell } from "@/components/keuangan/finance-ui";
import {
  createFinanceAccount,
  getFinanceExpenseAnalysis,
  getFinanceHealth,
  getFinanceProductRevenue,
  getFinanceReconciliationFindings,
  getFinanceSummary,
  getFinanceUnitRevenue,
  getKeuanganContext,
  listFinanceAccounts,
  listTransactions,
} from "@/features/keuangan";
import {
  formatFinanceDateTime,
  formatFinanceMoney,
  formatFinancePeriodLabel,
  formatFinanceTimezone,
  getFinancePeriodSelection,
  semanticFinanceLabel,
} from "@/features/keuangan";
import type { FinancePeriodPreset, FinanceTransaction } from "@/features/keuangan";
import { paths } from "@/routes/paths";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Data keuangan gagal dimuat.";
}

function monthLabel(startDate: string, timezone: string) {
  return new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(startDate + "T00:00:00Z"));
}

function transactionSourceLabel(item: FinanceTransaction) {
  const source = semanticFinanceLabel(item.sumber_type);
  if (item.sumber_type === "rental") return "Penyewaan";
  if (item.sumber_type === "reservation") return "Reservasi";
  if (item.sumber_type === "payment") return "Pembayaran";
  if (item.sumber_type === "purchase") return "Pembelian";
  if (item.sumber_type === "maintenance") return "Perawatan";
  if (source !== "-") return source;
  return item.jenis ? semanticFinanceLabel(item.jenis) : "Transaksi Keuangan";
}

function transactionHref(item: FinanceTransaction) {
  return paths.keuangan + "/transaksi/" + item.transaksi_keuangan_id;
}

export function FinanceHome() {
  const [preset, setPreset] = useState<FinancePeriodPreset>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [accountCode, setAccountCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<"kas" | "bank" | "e_wallet" | "lainnya">("kas");

  const queryClient = useQueryClient();

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
    queryFn: () => getFinanceSummary(context.data!.usahaId, period.startDate, period.endDateExclusive),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  const recentTransactions = useQuery({
    queryKey: ["keuangan", "home-transactions", context.data?.usahaId, period],
    queryFn: () =>
      listTransactions(context.data!.usahaId, {
        search: "",
        page: 1,
        pageSize: 5,
      }),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 15_000,
  });

  const expenseAnalysis = useQuery({
    queryKey: ["keuangan", "expense-analysis", context.data?.usahaId, period],
    queryFn: () => getFinanceExpenseAnalysis(context.data!.usahaId, period.startDate, period.endDateExclusive),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  const productRevenue = useQuery({
    queryKey: ["keuangan", "product-revenue", context.data?.usahaId, period],
    queryFn: () => getFinanceProductRevenue(context.data!.usahaId, period.startDate, period.endDateExclusive),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  const unitRevenue = useQuery({
    queryKey: ["keuangan", "unit-revenue", context.data?.usahaId, period],
    queryFn: () => getFinanceUnitRevenue(context.data!.usahaId, period.startDate, period.endDateExclusive),
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

  const accounts = useQuery({
    queryKey: ["keuangan", "accounts", context.data?.usahaId],
    queryFn: () => listFinanceAccounts(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 30_000,
  });

  const accountMutation = useMutation({
    mutationFn: () =>
      createFinanceAccount(context.data!.usahaId, {
        kodeAkun: accountCode,
        namaAkun: accountName,
        jenisAkun: accountType,
        mataUang: "IDR",
      }),
    onSuccess: async () => {
      setAccountCode("");
      setAccountName("");
      setAccountType("kas");
      setAccountFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["keuangan", "accounts"] });
    },
  });

  if (context.isPending || summary.isPending) {
    return (
      <FinanceShell variant="home" title="Keuangan">
        <div className="space-y-3">
          <div className="h-44 animate-pulse rounded-[24px] bg-muted sm:h-52" />
          <div className="grid grid-cols-3 gap-2">
            <div className="h-24 animate-pulse rounded-2xl bg-muted" />
            <div className="h-24 animate-pulse rounded-2xl bg-muted" />
            <div className="h-24 animate-pulse rounded-2xl bg-muted" />
          </div>
        </div>
      </FinanceShell>
    );
  }

  if (context.error || !context.data) {
    return (
      <FinanceShell variant="home" title="Keuangan">
        <Alert variant="destructive">
          <AlertTitle>Keuangan belum dapat dibuka</AlertTitle>
          <AlertDescription>{errorMessage(context.error)}</AlertDescription>
        </Alert>
      </FinanceShell>
    );
  }

  if (summary.error || !summary.data) {
    return (
      <FinanceShell variant="home" title="Keuangan">
        <Alert variant="destructive">
          <AlertTitle>Ringkasan Keuangan belum dapat dibuka</AlertTitle>
          <AlertDescription>{errorMessage(summary.error)}</AlertDescription>
        </Alert>
      </FinanceShell>
    );
  }

  const financeHealth = health.data;
  const findingCount =
    (financeHealth ? Object.values(financeHealth.critical).reduce((sum, value) => sum + value, 0) : 0) +
    (financeHealth ? Object.values(financeHealth.attention).reduce((sum, value) => sum + value, 0) : 0);
  const recentItems = recentTransactions.data?.transactions ?? [];

  return (
    <FinanceShell variant="home" title="Keuangan">
      <section className="relative isolate overflow-hidden rounded-[24px] border border-white/70 shadow-[0_10px_34px_rgba(24,70,56,.10)]">
        <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/login-bg.webp')" }} />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[#075645]/76 via-[#0f5b4a]/40 to-black/18" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/28 to-transparent" />
        <div className="relative px-4 pb-4 pt-4 text-white sm:px-6 sm:pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/88 text-[#0b5d4a] shadow-sm backdrop-blur">
              <BarChart3 className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/80">Keuangan</p>
              <h1 className="mt-1 text-[30px] font-bold leading-8 tracking-[-0.035em] sm:text-4xl">Keuangan</h1>
              <p className="mt-1 max-w-xl text-[11px] leading-5 text-white/90 sm:text-sm">
                Pantau pembayaran, pemasukan, pengeluaran, dan arus keuangan usaha.
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
                <span className="mt-0.5 block truncate text-[11px] font-semibold">{monthLabel(period.startDate, context.data.timezone)}</span>
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
                onClick={() => setPreset(value)}
                className={
                  "min-h-9 rounded-lg px-2 text-[9px] font-semibold " +
                  (preset === value ? "bg-primary text-primary-foreground" : "bg-muted/35 text-muted-foreground")
                }
              >
                {label}
              </button>
            ))}
            {preset === "custom" ? (
              <div className="col-span-2 grid grid-cols-2 gap-2 pt-1">
                <Input aria-label="Tanggal mulai" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="h-9 rounded-lg text-[10px]" />
                <Input aria-label="Tanggal selesai" type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="h-9 rounded-lg text-[10px]" />
              </div>
            ) : null}
          </div>
        </details>

        <details className="group rounded-2xl border border-border/60 bg-card shadow-[0_3px_12px_rgba(28,67,56,.04)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3.5 marker:hidden">
            <span className="flex min-w-0 items-center gap-2">
              <WalletCards className="size-4 text-primary" />
              <span className="min-w-0">
                <span className="block text-[9px] text-muted-foreground">Usaha</span>
                <span className="mt-0.5 block truncate text-[11px] font-semibold">{context.data.usahaNama}</span>
              </span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border/60 px-3.5 py-3 text-[10px] text-muted-foreground">
            Data mengikuti usaha aktif dan timezone {formatFinanceTimezone(context.data.timezone)}.
          </div>
        </details>
      </section>

      <section className="grid grid-cols-3 gap-2">
        <Card className="border-emerald-100 bg-emerald-50/55 shadow-none dark:border-emerald-900/35 dark:bg-emerald-950/10">
          <CardContent className="p-3.5">
            <div className="flex items-start justify-between gap-1">
              <div>
                <p className="text-[9px] font-medium text-muted-foreground">Pemasukan Tercatat</p>
                <p className="mt-1 text-[15px] font-bold tracking-tight tabular-nums text-emerald-800 dark:text-emerald-200">{formatFinanceMoney(summary.data.recorded_income)}</p>
                <p className="mt-1 text-[8px] text-muted-foreground">{summary.data.recorded_income_transaction_count} transaksi</p>
              </div>
              <span className="grid size-7 place-items-center rounded-lg bg-white/70 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><ArrowUpRight className="size-3.5" /></span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-rose-100 bg-rose-50/55 shadow-none dark:border-rose-900/35 dark:bg-rose-950/10">
          <CardContent className="p-3.5">
            <div className="flex items-start justify-between gap-1">
              <div>
                <p className="text-[9px] font-medium text-muted-foreground">Pengeluaran Tercatat</p>
                <p className="mt-1 text-[15px] font-bold tracking-tight tabular-nums text-rose-800 dark:text-rose-200">{formatFinanceMoney(summary.data.recorded_expense)}</p>
                <p className="mt-1 text-[8px] text-muted-foreground">{summary.data.recorded_expense_transaction_count} transaksi</p>
              </div>
              <span className="grid size-7 place-items-center rounded-lg bg-white/70 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"><ArrowDownRight className="size-3.5" /></span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-sky-100 bg-sky-50/55 shadow-none dark:border-sky-900/35 dark:bg-sky-950/10">
          <CardContent className="p-3.5">
            <div className="flex items-start justify-between gap-1">
              <div>
                <p className="text-[9px] font-medium text-muted-foreground">Net Operasional</p>
                <p className="mt-1 text-[15px] font-bold tracking-tight tabular-nums text-sky-800 dark:text-sky-200">{formatFinanceMoney(summary.data.net_operational_movement)}</p>
                <p className="mt-1 text-[8px] text-muted-foreground">Pemasukan − Pengeluaran</p>
              </div>
              <span className="grid size-7 place-items-center rounded-lg bg-white/70 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300"><BarChart3 className="size-3.5" /></span>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="rounded-[22px] border border-border/60 bg-card p-2.5 shadow-[0_4px_16px_rgba(30,68,57,.05)]">
        <div className="grid grid-cols-4 gap-1.5">
          <Link to={paths.keuangan + "/pembayaran/create"} className="flex min-h-[78px] flex-col items-center justify-center gap-1.5 rounded-xl bg-[#0a6b55] px-1.5 py-2 text-center text-white shadow-[0_8px_18px_rgba(10,107,85,.15)]">
            <Plus className="size-4.5" />
            <span className="text-[9px] font-semibold leading-3.5">Catat<br />Pembayaran</span>
          </Link>
          <Link to={paths.keuangan + "/pengeluaran/create"} className="flex min-h-[78px] flex-col items-center justify-center gap-1.5 rounded-xl bg-muted/35 px-1.5 py-2 text-center">
            <ReceiptText className="size-4.5 text-primary" />
            <span className="text-[9px] font-semibold leading-3.5">Catat<br />Pengeluaran</span>
          </Link>
          <Link to={paths.keuangan + "/transaksi"} className="flex min-h-[78px] flex-col items-center justify-center gap-1.5 rounded-xl bg-muted/35 px-1.5 py-2 text-center">
            <FileText className="size-4.5 text-primary" />
            <span className="text-[9px] font-semibold leading-3.5">Lihat<br />Transaksi</span>
          </Link>
          <Link to={paths.laporan} className="flex min-h-[78px] flex-col items-center justify-center gap-1.5 rounded-xl bg-muted/35 px-1.5 py-2 text-center">
            <BarChart3 className="size-4.5 text-primary" />
            <span className="text-[9px] font-semibold leading-3.5">Laporan<br />Keuangan</span>
          </Link>
        </div>
      </section>

      <section className="rounded-[22px] border border-border/60 bg-card p-3.5 shadow-[0_4px_16px_rgba(30,68,57,.04)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300"><CreditCard className="size-4.5" /></span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold">Pembayaran Tercatat</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Ringkasan pembayaran yang tercatat pada periode ini.</p>
            </div>
          </div>
          <Link to={paths.keuangan + "/pembayaran"} className="inline-flex shrink-0 items-center gap-0.5 pt-1 text-[10px] font-semibold text-primary">Lihat semua <ArrowRight className="size-3.5" /></Link>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2.5 dark:border-emerald-900/30 dark:bg-emerald-950/10">
            <p className="text-[9px] text-muted-foreground">Jumlah pembayaran</p>
            <p className="mt-1 text-[20px] font-bold tabular-nums">{summary.data.recorded_payment_count}</p>
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50/45 px-3 py-2.5 dark:border-sky-900/30 dark:bg-sky-950/10">
            <p className="text-[9px] text-muted-foreground">Nilai tercatat</p>
            <p className="mt-1 text-[17px] font-bold tabular-nums">{formatFinanceMoney(summary.data.recorded_payment_amount)}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[22px] border border-border/60 bg-card p-3.5 shadow-[0_4px_16px_rgba(30,68,57,.04)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300"><BarChart3 className="size-4.5" /></span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold">Transaksi Terbaru</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Lima transaksi keuangan terbaru.</p>
            </div>
          </div>
          <Link to={paths.keuangan + "/transaksi"} className="inline-flex shrink-0 items-center gap-0.5 pt-1 text-[10px] font-semibold text-primary">Lihat semua <ArrowRight className="size-3.5" /></Link>
        </div>

        <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
          {recentTransactions.isPending ? (
            <div className="px-3 py-4 text-center text-[10px] text-muted-foreground">Memuat transaksi terbaru…</div>
          ) : recentItems.length ? (
            recentItems.slice(0, 5).map((item) => {
              const incoming = item.arah === "income" || item.arah === "masuk";
              return (
                <Link key={item.transaksi_keuangan_id} to={transactionHref(item)} className="flex items-center gap-2.5 px-2.5 py-2.5 hover:bg-muted/20">
                  <span className={"grid size-8 shrink-0 place-items-center rounded-lg " + (incoming ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-300")}>
                    {incoming ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-semibold">{incoming ? "Pemasukan" : "Pengeluaran"}</span>
                    <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{transactionSourceLabel(item)} · {item.nomor_transaksi}</span>
                  </span>
                  <span className="text-right">
                    <span className={"block text-[10px] font-bold tabular-nums " + (incoming ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>
                      {incoming ? "+" : "−"}{formatFinanceMoney(Math.abs(Number(item.amount)), item.currency_code)}
                    </span>
                    <span className="mt-0.5 block text-[8px] text-muted-foreground">{formatFinanceDateTime(item.tanggal_transaksi, context.data.timezone)}</span>
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                </Link>
              );
            })
          ) : (
            <div className="px-3 py-4 text-center text-[10px] text-muted-foreground">Belum ada transaksi pada periode ini.</div>
          )}
        </div>
      </section>

      <section className="rounded-[20px] border border-emerald-100 bg-emerald-50/60 px-3.5 py-3.5 dark:border-emerald-900/25 dark:bg-emerald-950/10">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/75 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><WalletCards className="size-4.5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold">Perlu Perhatian</p>
            <p className="mt-0.5 text-[9px] leading-4 text-muted-foreground">
              {findingCount > 0 ? String(findingCount) + " temuan keuangan perlu diperiksa." : "Tidak ada temuan kritis atau perhatian dari pemeriksaan keuangan."}
            </p>
          </div>
          {findingCount === 0 ? (
            <span aria-label="Tidak ada temuan" className="grid size-6 place-items-center rounded-full bg-emerald-600 text-xs font-bold text-white">✓</span>
          ) : (
            <span className="min-w-6 rounded-full bg-amber-100 px-2 py-1 text-center text-[9px] font-semibold text-amber-800">{findingCount}</span>
          )}
        </div>
      </section>

      <section className="space-y-1.5">
        <details className="group rounded-[18px] border border-border/60 bg-card shadow-[0_2px_10px_rgba(30,68,57,.03)]">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3.5 marker:hidden">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/45 text-primary"><WalletCards className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[11px] font-bold">Akun Uang</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Kelola akun kas, bank, dan dompet.</span></span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-2 border-t border-border/60 px-3.5 py-3.5">
            {accountFormOpen || !accounts.data?.length ? (
              <div className="grid gap-2">
                <div className="grid gap-2 min-[430px]:grid-cols-2">
                  <Input value={accountCode} onChange={(event) => setAccountCode(event.target.value.toUpperCase())} placeholder="Kode akun" className="h-10 rounded-xl text-xs" />
                  <Input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Nama akun" className="h-10 rounded-xl text-xs" />
                </div>
                <div className="grid gap-2 min-[430px]:grid-cols-[1fr_auto]">
                  <select value={accountType} onChange={(event) => setAccountType(event.target.value as typeof accountType)} className="h-10 rounded-xl border bg-card px-3 text-xs">
                    <option value="kas">Kas</option>
                    <option value="bank">Bank</option>
                    <option value="e_wallet">Dompet</option>
                    <option value="lainnya">Lainnya</option>
                  </select>
                  <Button className="h-10 rounded-xl text-xs" disabled={accountMutation.isPending || !accountCode.trim() || !accountName.trim()} onClick={() => accountMutation.mutate()}>
                    {accountMutation.isPending ? "Menyimpan…" : "Buat Akun"}
                  </Button>
                </div>
                {accountMutation.error ? <p className="text-[10px] text-destructive">{errorMessage(accountMutation.error)}</p> : null}
              </div>
            ) : null}
            {accounts.data?.length ? (
              <div className="space-y-1.5">
                {accounts.data.slice(0, 4).map((account) => (
                  <div key={account.akun_keuangan_id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-semibold">{account.nama_akun}</p>
                      <p className="mt-0.5 text-[9px] text-muted-foreground">{account.kode_akun} · {semanticFinanceLabel(account.jenis_akun)}</p>
                    </div>
                    <WalletCards className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                ))}
              </div>
            ) : null}
            <button type="button" className="text-[10px] font-semibold text-primary" onClick={() => setAccountFormOpen((open) => !open)}>{accountFormOpen ? "Tutup tambah akun" : "Tambah akun"}</button>
          </div>
        </details>

        <details className="group rounded-[18px] border border-border/60 bg-card shadow-[0_2px_10px_rgba(30,68,57,.03)]">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3.5 marker:hidden">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300"><ArrowUpRight className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[11px] font-bold">Rekap Pemasukan</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Lihat rincian pemasukan dari transaksi keuangan.</span></span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border/60 px-3.5 py-3.5 text-[10px]">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Pemasukan periode</span><strong>{formatFinanceMoney(summary.data.recorded_income)}</strong></div>
            <div className="mt-2 text-muted-foreground">{summary.data.recorded_income_transaction_count} transaksi pemasukan tercatat.</div>
            <Link to={paths.keuangan + "/transaksi"} className="mt-3 inline-flex items-center gap-1 font-semibold text-primary">Lihat transaksi <ArrowRight className="size-3.5" /></Link>
          </div>
        </details>

        <details className="group rounded-[18px] border border-border/60 bg-card shadow-[0_2px_10px_rgba(30,68,57,.03)]">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3.5 marker:hidden">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-300"><ArrowDownRight className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[11px] font-bold">Rekap Pengeluaran</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Lihat rincian pengeluaran usaha.</span></span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border/60 px-3.5 py-3.5 text-[10px]">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Pengeluaran periode</span><strong>{formatFinanceMoney(summary.data.recorded_expense)}</strong></div>
            <div className="mt-2 text-muted-foreground">{summary.data.recorded_expense_transaction_count} transaksi pengeluaran tercatat.</div>
            <Link to={paths.keuangan + "/pengeluaran"} className="mt-3 inline-flex items-center gap-1 font-semibold text-primary">Lihat pengeluaran <ArrowRight className="size-3.5" /></Link>
          </div>
        </details>

        <details className="group rounded-[18px] border border-border/60 bg-card shadow-[0_2px_10px_rgba(30,68,57,.03)]">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3.5 marker:hidden">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/45 text-primary"><Settings2 className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[11px] font-bold">Pengaturan & Rekonsiliasi</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Periksa kesehatan dan temuan keuangan.</span></span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-2 border-t border-border/60 px-3.5 py-3.5">
            {financeHealth ? (
              <div className="rounded-xl border border-border/60 bg-muted/15 px-3 py-2.5">
                <p className="text-[10px] font-semibold">Status Keuangan</p>
                <p className="mt-1 text-[9px] text-muted-foreground">{financeHealth.status === "HEALTHY" ? "Tidak ada temuan yang membutuhkan perhatian." : String(findingCount) + " temuan tercatat."}</p>
              </div>
            ) : null}
            {findings.data?.items.length ? (
              <div className="space-y-1.5">
                {findings.data.items.slice(0, 4).map((finding, index) => (
                  <div key={finding.code + "-" + index} className="rounded-xl border border-border/60 px-3 py-2.5">
                    <p className="text-[10px] font-semibold">{finding.severity === "critical" ? "Temuan penting" : "Perlu diperiksa"}</p>
                    <p className="mt-0.5 text-[9px] text-muted-foreground">Ada ketidaksesuaian yang dikembalikan server.</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </details>

        <details className="group rounded-[18px] border border-border/60 bg-card shadow-[0_2px_10px_rgba(30,68,57,.03)]" open={analysisOpen}>
          <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3.5 marker:hidden" onClick={(event) => { event.preventDefault(); setAnalysisOpen((open) => !open); }}>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/20 dark:text-sky-300"><BarChart3 className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[11px] font-bold">Analisis Keuangan</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Pendapatan per produk, unit, dan sumber pengeluaran.</span></span>
            <ChevronDown className={"size-4 text-muted-foreground transition-transform " + (analysisOpen ? "rotate-180" : "")} />
          </summary>
          {analysisOpen ? (
            <div className="space-y-2 border-t border-border/60 px-3.5 py-3.5">
              {productRevenue.data ? (
                <div className="rounded-xl border border-border/60 px-3 py-3">
                  <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold">Kontribusi Pendapatan per Produk</p><span className="text-[9px] text-muted-foreground">{productRevenue.data.coverage_ratio === null ? "-" : String(Math.round(productRevenue.data.coverage_ratio * 100)) + "%"}</span></div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-emerald-50/60 px-2.5 py-2 dark:bg-emerald-950/10"><p className="text-[8px] text-muted-foreground">Dapat ditelusuri</p><p className="mt-1 text-[11px] font-bold">{formatFinanceMoney(productRevenue.data.exact_attributable_income)}</p></div>
                    <div className="rounded-lg bg-amber-50/60 px-2.5 py-2 dark:bg-amber-950/10"><p className="text-[8px] text-muted-foreground">Belum dapat ditelusuri</p><p className="mt-1 text-[11px] font-bold">{formatFinanceMoney(productRevenue.data.unallocated_income)}</p></div>
                  </div>
                </div>
              ) : null}

              {unitRevenue.data ? (
                <div className="rounded-xl border border-border/60 px-3 py-3">
                  <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold">Pendapatan per Unit</p><span className="text-[9px] text-muted-foreground">{unitRevenue.data.coverage_ratio === null ? "-" : String(Math.round(unitRevenue.data.coverage_ratio * 100)) + "%"}</span></div>
                  <div className="mt-2 flex items-center justify-between gap-3"><span className="text-[9px] text-muted-foreground">Dapat ditelusuri</span><strong className="text-[11px]">{formatFinanceMoney(unitRevenue.data.exact_unit_attributable_income)}</strong></div>
                  <div className="mt-1 flex items-center justify-between gap-3"><span className="text-[9px] text-muted-foreground">Belum dapat ditelusuri</span><strong className="text-[11px]">{formatFinanceMoney(unitRevenue.data.unallocated_or_ambiguous_income)}</strong></div>
                </div>
              ) : null}

              {expenseAnalysis.data ? (
                <div className="rounded-xl border border-border/60 px-3 py-3">
                  <p className="text-[10px] font-semibold">Pengeluaran per Sumber</p>
                  <div className="mt-2 space-y-1.5">
                    {expenseAnalysis.data.by_source.slice(0, 4).map((item) => (
                      <div key={item.source_type ?? "tanpa-sumber"} className="flex items-center justify-between gap-3 text-[9px]">
                        <span className="text-muted-foreground">{item.source_type ? semanticFinanceLabel(item.source_type) : "Tanpa sumber"}</span>
                        <span className="font-semibold">{formatFinanceMoney(item.amount)} · {item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <Link to={paths.laporan} className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary">Lihat Laporan Keuangan <ArrowRight className="size-3.5" /></Link>
            </div>
          ) : null}
        </details>
      </section>

      <div className="flex items-center justify-center px-2 text-[9px] text-muted-foreground">
        Periode: {formatFinancePeriodLabel(summary.data.start_date, summary.data.end_date_exclusive, summary.data.timezone)}
      </div>
    </FinanceShell>
  );
}

FinanceHome.displayName = "FinanceHome";
