import { useQuery } from "@tanstack/react-query";
import { Building2, CircleDollarSign, ChevronRight, WalletCards } from "lucide-react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FinanceShell } from "@/components/keuangan/finance-ui";
import { getFinanceAccountSummary, getKeuanganContext } from "@/features/keuangan";
import { formatFinanceMoney } from "@/features/keuangan/utils";
import { paths } from "@/routes/paths";

function accountTypeLabel(value: string) {
  if (value === "kas") return "Kas";
  if (value === "bank") return "Bank";
  if (value === "e_wallet") return "Dompet Digital";
  return "Lainnya";
}

export function FinanceAccountList() {
  const context = useQuery({ queryKey: ["keuangan", "context"], queryFn: getKeuanganContext, staleTime: 60_000 });
  const accounts = useQuery({
    queryKey: ["keuangan", "account-summary", context.data?.usahaId],
    queryFn: () => getFinanceAccountSummary(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 10_000,
  });

  if (context.isPending || accounts.isPending) {
    return (
      <FinanceShell variant="home" title="Akun Uang">
        <Skeleton className="h-44 rounded-[24px]" />
      </FinanceShell>
    );
  }

  if (context.error || accounts.error || !accounts.data) {
    return (
      <FinanceShell variant="home" title="Akun Uang">
        <Alert variant="destructive">
          <AlertTitle>Akun keuangan belum dapat dibaca</AlertTitle>
          <AlertDescription>{(accounts.error ?? context.error)?.message ?? "Data akun tidak tersedia."}</AlertDescription>
        </Alert>
      </FinanceShell>
    );
  }

  const active = accounts.data.accounts.filter((account) => account.status === "active");
  const currencies = Array.from(new Set(active.map((account) => account.mata_uang)));

  return (
    <FinanceShell variant="home" title="Akun Uang">
      <section className="relative isolate overflow-hidden rounded-[24px] border border-white/70 shadow-[0_10px_34px_rgba(24,70,56,.10)]">
        <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/login-bg.webp')" }} />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[#075645]/76 via-[#0f5b4a]/40 to-black/18" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/28 to-transparent" />
        <div className="relative px-4 pb-4 pt-4 text-white sm:px-6 sm:pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/88 text-[#0b5d4a] shadow-sm backdrop-blur">
              <WalletCards className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/80">Keuangan</p>
              <h1 className="mt-1 text-[29px] font-bold leading-8 tracking-[-0.035em] sm:text-4xl">Akun Uang</h1>
              <p className="mt-1 max-w-xl text-[11px] leading-5 text-white/90 sm:text-sm">
                Kelola akun Kas, Bank, dan Dompet Digital tanpa kehilangan jejak transaksi.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-white/25 bg-white/12 px-2.5 py-1 text-[9px] font-semibold backdrop-blur">
              {context.data.usahaNama}
            </span>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2">
        <div className="rounded-[18px] border border-border/60 bg-emerald-50/55 px-3 py-3 dark:border-emerald-900/30 dark:bg-emerald-950/10">
          <p className="text-[9px] text-muted-foreground">Akun Aktif</p>
          <p className="mt-1 text-[18px] font-bold tabular-nums">{active.length}</p>
        </div>
        <div className="rounded-[18px] border border-border/60 bg-emerald-50/55 px-3 py-3 dark:border-emerald-900/30 dark:bg-emerald-950/10">
          <p className="text-[9px] text-muted-foreground">Uang Masuk</p>
          <p className="mt-1 text-[14px] font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
            {currencies.length === 1 ? formatFinanceMoney(accounts.data.totals.uang_masuk, currencies[0]) : "Multi-currency"}
          </p>
        </div>
        <div className="rounded-[18px] border border-border/60 bg-rose-50/55 px-3 py-3 dark:border-rose-900/30 dark:bg-rose-950/10">
          <p className="text-[9px] text-muted-foreground">Uang Keluar</p>
          <p className="mt-1 text-[14px] font-bold tabular-nums text-rose-800 dark:text-rose-200">
            {currencies.length === 1 ? formatFinanceMoney(accounts.data.totals.uang_keluar, currencies[0]) : "Multi-currency"}
          </p>
        </div>
      </section>

      <Alert className="rounded-[20px] border-primary/10 bg-primary/[0.035]">
        <Building2 className="size-4" />
        <AlertTitle>Saldo akun mengikuti transaksi tercatat</AlertTitle>
        <AlertDescription>Saldo berasal dari saldo awal dan pergerakan keuangan yang tercatat. Tidak ada angka saldo manual yang dibuat hanya untuk tampilan.</AlertDescription>
      </Alert>

      <section className="space-y-2.5">
        {accounts.data.accounts.map((account) => (
          <Link key={account.akun_keuangan_id} to={paths.keuangan + "/akun/" + account.akun_keuangan_id} className="block">
            <article className="overflow-hidden rounded-[22px] border border-border/60 bg-card shadow-[0_4px_16px_rgba(30,68,57,.04)] transition hover:border-primary/20 hover:shadow-[0_8px_24px_rgba(30,68,57,.07)]">
              <div className="flex items-start justify-between gap-3 px-3.5 pb-3 pt-3.5">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    {account.jenis_akun === "bank" ? <Building2 className="size-5" /> : account.jenis_akun === "kas" ? <CircleDollarSign className="size-5" /> : <WalletCards className="size-5" />}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-bold">{account.nama_akun}</p>
                    <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{account.kode_akun} · {accountTypeLabel(account.jenis_akun)} · {account.mata_uang}</p>
                  </div>
                </div>
                <Badge variant={account.status === "active" ? "default" : "outline"} className="shrink-0 rounded-full text-[9px]">
                  {account.status === "active" ? "Aktif" : "Nonaktif"}
                </Badge>
              </div>

              <div className="mx-3.5 rounded-[18px] bg-slate-950 px-4 py-3.5 text-white dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[9px] text-white/55">Saldo Akun</p>
                    <p className="mt-1 text-[22px] font-bold tracking-tight tabular-nums">{formatFinanceMoney(account.saldo, account.mata_uang)}</p>
                  </div>
                  <WalletCards className="mt-1 size-4 text-white/50" />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-2.5 text-[9px]">
                  <span className="text-white/55">Saldo awal <strong className="ml-1 font-semibold text-white/85">{formatFinanceMoney(account.saldo_awal, account.mata_uang)}</strong></span>
                  <span className="text-right text-white/55">Mata uang <strong className="ml-1 font-semibold text-white/85">{account.mata_uang}</strong></span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-px border-t border-border/60 bg-border/60">
                <div className="bg-card px-3.5 py-3">
                  <p className="text-[9px] text-muted-foreground">Uang masuk</p>
                  <p className="mt-1 text-[11px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{formatFinanceMoney(account.uang_masuk, account.mata_uang)}</p>
                </div>
                <div className="bg-card px-3.5 py-3 text-right">
                  <p className="text-[9px] text-muted-foreground">Uang keluar</p>
                  <p className="mt-1 text-[11px] font-bold tabular-nums text-rose-700 dark:text-rose-300">{formatFinanceMoney(account.uang_keluar, account.mata_uang)}</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                <span className="text-[9px] text-muted-foreground">Lihat detail dan mutasi akun</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </div>
            </article>
          </Link>
        ))}
      </section>

      {accounts.data.accounts.length === 0 ? (
        <Card className="rounded-[22px] border-dashed">
          <CardContent className="p-7 text-center">
            <WalletCards className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">Belum ada akun keuangan</p>
            <p className="mt-1 text-xs text-muted-foreground">Buat akun melalui setup Keuangan sebelum mencatat pembayaran.</p>
            <Link to={paths.keuangan} className="mt-4 inline-flex rounded-xl border px-4 py-2 text-sm font-semibold">Buka Keuangan</Link>
          </CardContent>
        </Card>
      ) : null}
    </FinanceShell>
  );
}
