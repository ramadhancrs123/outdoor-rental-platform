import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Building2, CircleAlert, ChevronDown, ShieldCheck, WalletCards } from "lucide-react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FinanceShell } from "@/components/keuangan/finance-ui";
import { getFinanceAccountDetail, getKeuanganContext } from "@/features/keuangan";
import { formatFinanceDateTime, formatFinanceMoney, formatFinanceTimezone, semanticFinanceLabel } from "@/features/keuangan/utils";
import { paths } from "@/routes/paths";

function movementSourceLabel(movement: Awaited<ReturnType<typeof getFinanceAccountDetail>>["movements"][number]) {
  if (movement.payment_id) {
    return [
      movement.payment_number ? "Pembayaran #" + movement.payment_number : "Pembayaran",
      movement.payment_type ? semanticFinanceLabel(movement.payment_type) : null,
      movement.rental_number ?? null,
    ].filter(Boolean).join(" · ");
  }
  if (movement.expense_id) {
    return ["Pengeluaran", movement.expense_category ?? null, movement.expense_description ?? null].filter(Boolean).join(" · ");
  }
  if (movement.sumber_type === "transfer") return "Transfer antar akun";
  return semanticFinanceLabel(movement.sumber_type);
}

function movementHref(movement: Awaited<ReturnType<typeof getFinanceAccountDetail>>["movements"][number]) {
  if (movement.payment_id) return paths.keuangan + "/pembayaran/" + movement.payment_id;
  if (movement.expense_id) return paths.keuangan + "/pengeluaran/" + movement.expense_id;
  if (movement.transaksi_keuangan_id) return paths.keuangan + "/transaksi/" + movement.transaksi_keuangan_id;
  return paths.keuangan + "/akun";
}

export function FinanceAccountShow() {
  const { id } = useParams();
  const context = useQuery({ queryKey: ["keuangan", "context"], queryFn: getKeuanganContext, staleTime: 60_000 });
  const detail = useQuery({
    queryKey: ["keuangan", "account-detail", context.data?.usahaId, id],
    queryFn: () => getFinanceAccountDetail(context.data!.usahaId, id!),
    enabled: Boolean(context.data?.usahaId && id),
    staleTime: 5_000,
  });

  if (context.isPending || detail.isPending) {
    return (
      <FinanceShell variant="home" title="Detail Akun">
        <div className="space-y-3">
          <Skeleton className="h-64 rounded-[26px]" />
          <Skeleton className="h-24 rounded-[20px]" />
          <Skeleton className="h-72 rounded-[22px]" />
        </div>
      </FinanceShell>
    );
  }

  if (context.error || detail.error || !detail.data) {
    return (
      <FinanceShell variant="home" title="Detail Akun">
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>Detail akun belum dapat dibaca</AlertTitle>
          <AlertDescription>{(detail.error ?? context.error)?.message ?? "Data akun tidak tersedia."}</AlertDescription>
        </Alert>
      </FinanceShell>
    );
  }

  const { account, movements } = detail.data;
  const isBank = account.jenis_akun === "bank";
  const accountType = isBank ? "Bank" : account.jenis_akun === "kas" ? "Kas" : account.jenis_akun === "e_wallet" ? "Dompet Digital" : "Lainnya";

  return (
    <FinanceShell variant="home" title="Detail Akun">
      <section className="relative isolate overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-[0_18px_50px_rgba(6,50,39,.20)] dark:bg-slate-900">
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_88%_15%,rgba(100,185,157,.24),transparent_34%),radial-gradient(circle_at_10%_85%,rgba(11,112,86,.30),transparent_42%)]" />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[#063e31]/95 via-[#075645]/85 to-slate-950/95" />
        <div className="relative p-5 sm:p-7">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/10 text-white backdrop-blur">
                {isBank ? <Building2 className="size-6" /> : <WalletCards className="size-6" />}
              </span>
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/55">Akun Uang</p>
                <h1 className="mt-1 truncate text-[20px] font-bold tracking-tight sm:text-2xl">{account.nama_akun}</h1>
                <p className="mt-1 truncate text-[10px] text-white/55">{account.kode_akun} · {accountType} · {account.mata_uang}</p>
              </div>
            </div>
            <Badge className="shrink-0 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/10">
              {account.status === "active" ? "Aktif" : "Nonaktif"}
            </Badge>
          </div>

          <div className="mt-8">
            <p className="text-[10px] font-medium text-white/55">Saldo Akun</p>
            <p className="mt-1 text-[36px] font-bold leading-none tracking-[-0.04em] tabular-nums sm:text-5xl">
              {formatFinanceMoney(account.saldo, account.mata_uang)}
            </p>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10">
            <div className="bg-white/[0.035] px-3.5 py-3">
              <p className="text-[9px] text-white/45">Saldo awal</p>
              <p className="mt-1 text-[12px] font-semibold tabular-nums text-white/90">{formatFinanceMoney(account.saldo_awal, account.mata_uang)}</p>
            </div>
            <div className="bg-white/[0.035] px-3.5 py-3 text-right">
              <p className="text-[9px] text-white/45">Mata uang</p>
              <p className="mt-1 text-[12px] font-semibold text-white/90">{account.mata_uang}</p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 text-[9px] text-white/45">
            <span>Data saldo berasal dari fakta keuangan tercatat.</span>
            <ShieldCheck className="size-4 text-emerald-300/80" />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <div className="rounded-[20px] border border-emerald-100 bg-emerald-50/60 px-3.5 py-3.5 dark:border-emerald-900/30 dark:bg-emerald-950/10">
          <p className="text-[9px] text-muted-foreground">Uang masuk</p>
          <p className="mt-1 text-[16px] font-bold tabular-nums text-emerald-800 dark:text-emerald-200">{formatFinanceMoney(account.uang_masuk, account.mata_uang)}</p>
        </div>
        <div className="rounded-[20px] border border-rose-100 bg-rose-50/60 px-3.5 py-3.5 dark:border-rose-900/30 dark:bg-rose-950/10">
          <p className="text-[9px] text-muted-foreground">Uang keluar</p>
          <p className="mt-1 text-[16px] font-bold tabular-nums text-rose-800 dark:text-rose-200">{formatFinanceMoney(account.uang_keluar, account.mata_uang)}</p>
        </div>
      </section>

      <details className="group rounded-[20px] border border-border/60 bg-card shadow-[0_4px_16px_rgba(30,68,57,.04)]">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3.5 marker:hidden">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><WalletCards className="size-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-bold">Informasi Akun</span>
            <span className="mt-0.5 block text-[9px] text-muted-foreground">Detail dasar akun dan konteks waktu.</span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-3 border-t border-border/60 px-3.5 py-3.5 sm:grid-cols-2">
          <InfoBox label="Nama Akun" value={account.nama_akun} />
          <InfoBox label="Kode Akun" value={account.kode_akun} />
          <InfoBox label="Jenis Akun" value={accountType} />
          <InfoBox label="Status" value={account.status === "active" ? "Aktif" : "Nonaktif"} />
          <InfoBox label="Mata Uang" value={account.mata_uang} />
          <InfoBox label="Zona Waktu" value={context.data.timezone ? formatFinanceTimezone(context.data.timezone) : "Zona waktu Usaha"} />
        </div>
      </details>

      <section className="rounded-[22px] border border-border/60 bg-card p-3.5 shadow-[0_4px_16px_rgba(30,68,57,.04)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><WalletCards className="size-4.5" /></span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold">Mutasi Akun</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{movements.length} mutasi terbaru.</p>
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {movements.length ? movements.map((movement) => {
            const masuk = movement.arah === "masuk";
            return (
              <Link
                key={movement.pergerakan_akun_keuangan_id}
                to={movementHref(movement)}
                className="block rounded-[18px] border border-border/60 bg-background px-3 py-3 transition hover:bg-muted/20"
              >
                <div className="flex items-start gap-2.5">
                  <span className={masuk ? "grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300" : "grid size-9 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/25 dark:text-rose-300"}>
                    {masuk ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[10px] font-semibold">{movementSourceLabel(movement)}</p>
                        <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                          {formatFinanceDateTime(movement.terjadi_at, context.data.timezone)}
                          {movement.transaksi_nomor ? " · " + movement.transaksi_nomor : ""}
                        </p>
                      </div>
                      <p className={masuk ? "shrink-0 text-[12px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300" : "shrink-0 text-[12px] font-bold tabular-nums text-rose-700 dark:text-rose-300"}>
                        {masuk ? "+" : "−"}{formatFinanceMoney(movement.amount, movement.mata_uang)}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="rounded-full text-[8px]">{semanticFinanceLabel(movement.sumber_type)}</Badge>
                      <Badge variant={movement.status === "recorded" ? "secondary" : "outline"} className="rounded-full text-[8px]">{semanticFinanceLabel(movement.status)}</Badge>
                      {movement.payment_method ? <Badge variant="outline" className="rounded-full text-[8px]">{semanticFinanceLabel(movement.payment_method)}</Badge> : null}
                    </div>
                    {movement.catatan ? <p className="mt-2 text-[9px] leading-4 text-muted-foreground">{movement.catatan}</p> : null}
                    <div className="mt-2 flex items-center justify-end gap-1 text-[9px] font-semibold text-primary">Lihat sumber <ArrowRight className="size-3.5" /></div>
                  </div>
                </div>
              </Link>
            );
          }) : (
            <div className="rounded-[18px] border border-dashed p-8 text-center">
              <WalletCards className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold">Belum ada mutasi</p>
              <p className="mt-1 text-xs text-muted-foreground">Pergerakan uang akan muncul ketika payment, expense, atau transfer tercatat.</p>
            </div>
          )}
        </div>
      </section>

      <Alert className="rounded-[20px] border-primary/10 bg-primary/[0.035]">
        <ShieldCheck className="size-4" />
        <AlertTitle>Riwayat tetap dapat ditelusuri</AlertTitle>
        <AlertDescription>Mutasi akun mengarah kembali ke Pembayaran, Pengeluaran, atau Transaksi Keuangan sumber. Koreksi tidak menghapus histori.</AlertDescription>
      </Alert>
    </FinanceShell>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-muted/20 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-semibold">{value}</p></div>;
}
