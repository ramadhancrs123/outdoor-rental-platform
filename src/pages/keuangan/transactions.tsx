import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, ChevronDown, RefreshCw, WalletCards } from "lucide-react";
import { Link, useParams } from "react-router";

import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FinanceShell, FinanceStatus } from "@/components/keuangan/finance-ui";
import {
  getFinanceTransactionPage,
  getKeuanganContext,
  getTransaction,
  useFinancePeriod,
  formatFinanceDateTime,
  formatFinanceMoney,
  formatFinancePeriodLabel,
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
  const queryClient = useQueryClient();
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

  if (context.isPending) {
    return <FinanceShell variant="home" title="Transaksi"><Skeleton className="h-44 rounded-[24px]" /></FinanceShell>;
  }

  if (context.error || !context.data) {
    return (
      <FinanceShell variant="home" title="Transaksi">
        <Alert variant="destructive"><AlertTitle>Transaksi belum dapat dibuka</AlertTitle><AlertDescription>{errorMessage(context.error)}</AlertDescription></Alert>
      </FinanceShell>
    );
  }

  const data = query.data;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 20)));
  const currentPage = data ? Math.floor(data.offset / data.limit) + 1 : 1;
  const currentPeriodLabel = data
    ? formatFinancePeriodLabel(data.start_date, data.end_date_exclusive, data.timezone)
    : "Periode dipilih";

  const fetchPage = async (page: number) => {
    if (!context.data || !data) return;
    const next = await getFinanceTransactionPage(
      context.data.usahaId,
      data.start_date,
      data.end_date_exclusive,
      data.limit,
      (page - 1) * data.limit,
    );
    queryClient.setQueryData(
      ["keuangan", "transactions", context.data.usahaId, periodState.period],
      next,
    );
  };

  return (
    <FinanceShell variant="home" title="Transaksi">
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
              <h1 className="mt-1 text-[29px] font-bold leading-8 tracking-[-0.035em] sm:text-4xl">Transaksi</h1>
              <p className="mt-1 max-w-xl text-[11px] leading-5 text-white/90 sm:text-sm">Lihat semua fakta keuangan yang tercatat dan dapat ditelusuri.</p>
            </div>
            <span className="shrink-0 rounded-full border border-white/25 bg-white/12 px-2.5 py-1 text-[9px] font-semibold backdrop-blur">{context.data.usahaNama}</span>
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
                <span className="mt-0.5 block truncate text-[11px] font-semibold">{currentPeriodLabel}</span>
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
                onClick={() => periodState.setPreset(value)}
                className={"min-h-9 rounded-lg px-2 text-[9px] font-semibold " + (periodState.period.preset === value ? "bg-primary text-primary-foreground" : "bg-muted/35 text-muted-foreground")}
              >
                {label}
              </button>
            ))}
            {periodState.period.preset === "custom" ? (
              <div className="col-span-2 grid grid-cols-2 gap-2 pt-1">
                <input aria-label="Tanggal mulai" type="date" value={periodState.period.startDate} onChange={(event) => { periodState.setCustomStart(event.target.value); periodState.setPreset("custom"); }} className="h-9 min-w-0 rounded-lg border bg-card px-2 text-[10px]" />
                <input aria-label="Tanggal selesai" type="date" value={periodState.period.endDateExclusive.slice(0, 10)} onChange={(event) => { periodState.setCustomEnd(event.target.value); periodState.setPreset("custom"); }} className="h-9 min-w-0 rounded-lg border bg-card px-2 text-[10px]" />
              </div>
            ) : null}
          </div>
        </details>

        <details className="group rounded-2xl border border-border/60 bg-card shadow-[0_3px_12px_rgba(28,67,56,.04)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3.5 marker:hidden">
            <span className="flex min-w-0 items-center gap-2">
              <WalletCards className="size-4 text-primary" />
              <span className="min-w-0">
                <span className="block text-[9px] text-muted-foreground">Ringkasan</span>
                <span className="mt-0.5 block truncate text-[11px] font-semibold">{data?.total ?? 0} transaksi</span>
              </span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border/60 px-3.5 py-3 text-[10px] leading-4 text-muted-foreground">
            Daftar ini membaca fakta transaksi keuangan. Detail sumber tetap dapat dibuka tanpa mengubah transaksi secara langsung.
          </div>
        </details>
      </section>

      {query.isPending ? (
        <section className="space-y-2.5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-[20px]" />)}</section>
      ) : query.error ? (
        <Alert variant="destructive">
          <AlertTitle>Daftar transaksi belum tersedia</AlertTitle>
          <AlertDescription className="space-y-3"><p>{errorMessage(query.error)}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}><RefreshCw />Coba lagi</Button></AlertDescription>
        </Alert>
      ) : data && data.items.length === 0 ? (
        <section className="rounded-[22px] border border-dashed bg-card p-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sky-50 text-sky-700 dark:bg-sky-950/20 dark:text-sky-300"><WalletCards className="size-6" /></span>
          <h2 className="mt-4 text-[16px] font-bold">Belum ada transaksi</h2>
          <p className="mx-auto mt-1 max-w-sm text-[10px] leading-5 text-muted-foreground">Belum ada transaksi keuangan pada periode yang dipilih.</p>
        </section>
      ) : data ? (
        <>
          <section className="rounded-[22px] border border-border/60 bg-card p-3.5 shadow-[0_4px_16px_rgba(30,68,57,.04)]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700 dark:bg-sky-950/25 dark:text-sky-300"><BarChart3 className="size-4.5" /></span>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold">Transaksi Tercatat</h2>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{data.total} transaksi pada periode ini.</p>
                </div>
              </div>
              <span className="rounded-full bg-muted/50 px-2.5 py-1 text-[9px] font-semibold text-muted-foreground">{currentPeriodLabel}</span>
            </div>
          </section>

          <div className="grid min-w-0 gap-2.5 md:hidden">
            {data.items.map((item) => {
              const masuk = item.arah === "income" || item.arah === "masuk";
              return (
                <Link key={item.transaksi_keuangan_id} to={paths.keuangan + "/transaksi/" + item.transaksi_keuangan_id} className="block min-w-0">
                  <article className="min-w-0 overflow-hidden rounded-[18px] border border-border/60 bg-background px-3 py-3 transition-colors hover:bg-muted/20">
                    <div className="flex items-start gap-2.5">
                      <span className={"grid size-9 shrink-0 place-items-center rounded-xl " + (masuk ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-950/25 dark:text-rose-300")}>
                        {masuk ? <ArrowDownRight className="size-4" /> : <ArrowUpRight className="size-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-[10px] font-semibold">{item.nomor_transaksi}</p>
                            <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{semanticFinanceLabel(item.jenis)} · {masuk ? "Pemasukan" : "Pengeluaran"}</p>
                          </div>
                          <div className="text-right">
                            <p className={"text-[13px] font-bold tabular-nums " + (masuk ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>{masuk ? "+" : "−"}{formatFinanceMoney(item.amount, item.currency_code)}</p>
                            <span className="mt-1 inline-flex rounded-full bg-muted/50 px-2 py-0.5 text-[8px] font-semibold text-muted-foreground">{semanticFinanceLabel(item.status)}</span>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
                          <span>{formatFinanceDateTime(item.tanggal_transaksi, data.timezone)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{semanticFinanceLabel(item.sumber_type) || "Sumber belum ditautkan"}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-end gap-1 text-[9px] font-semibold text-primary">Lihat detail <ArrowRight className="size-3.5" /></div>
                      </div>
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>

          <section className="hidden overflow-hidden rounded-[22px] border border-border/60 bg-card shadow-[0_4px_16px_rgba(30,68,57,.04)] md:block">
            <div className="border-b border-border/60 px-4 py-3.5">
              <h2 className="text-[15px] font-bold">Daftar Transaksi</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{data.total} transaksi · {currentPeriodLabel}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/25 text-left">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold">Transaksi</th>
                    <th className="px-4 py-3 text-xs font-semibold">Jenis</th>
                    <th className="px-4 py-3 text-xs font-semibold">Arah</th>
                    <th className="px-4 py-3 text-xs font-semibold">Sumber</th>
                    <th className="px-4 py-3 text-xs font-semibold">Nominal</th>
                    <th className="px-4 py-3 text-xs font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.transaksi_keuangan_id} className="border-b last:border-0">
                      <td className="px-4 py-3.5">
                        <Link to={paths.keuangan + "/transaksi/" + item.transaksi_keuangan_id} className="font-semibold hover:text-primary hover:underline">
                          <span className="block">{item.nomor_transaksi}</span>
                          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{formatFinanceDateTime(item.tanggal_transaksi, data.timezone)}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">{semanticFinanceLabel(item.jenis)}</td>
                      <td className="px-4 py-3.5">{item.arah === "income" || item.arah === "masuk" ? "Pemasukan" : "Pengeluaran"}</td>
                      <td className="px-4 py-3.5">{semanticFinanceLabel(item.sumber_type) || "-"}</td>
                      <td className="px-4 py-3.5 font-semibold tabular-nums">{formatFinanceMoney(item.amount, item.currency_code)}</td>
                      <td className="px-4 py-3.5"><FinanceStatus status={semanticFinanceLabel(item.status)} tone={statusTone(item.status)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-3.5 py-3 text-[10px]">
            <span className="text-muted-foreground">Halaman {currentPage} dari {totalPages}</span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={currentPage <= 1} className="h-9 rounded-xl px-3 text-[10px]" onClick={() => void fetchPage(currentPage - 1)}>Sebelumnya</Button>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages} className="h-9 rounded-xl px-3 text-[10px]" onClick={() => void fetchPage(currentPage + 1)}>Berikutnya</Button>
            </div>
          </div>
        </>
      ) : null}

      <div className="flex items-center justify-center px-2 pb-2 text-[9px] text-muted-foreground">Periode: {currentPeriodLabel} · Data transaksi sesuai Usaha aktif.</div>
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
          <Info label="Jenis Sumber" value={semanticFinanceLabel(item.sumber_type)} />
          <Info label="Source ID" value={item.sumber_id ?? "-"} />
          <Info label="Status" value={semanticFinanceLabel(item.status)} />
          <Info label="Mata Uang" value={item.currency_code} />
          <div className="sm:col-span-2"><Info label="Catatan" value={item.catatan ?? "-"} /></div>
        </CardContent>
      </Card>
      <Card className="border-primary/10 bg-primary/[0.03] shadow-sm">
        <CardContent className="space-y-3 p-5">
          <p className="text-sm font-semibold">Traceability</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Transaksi Keuangan → {semanticFinanceLabel(item.sumber_type) || "Sumber"} → {item.sumber_id ?? "sumber belum ditautkan"}.
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
