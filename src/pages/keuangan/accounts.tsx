import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Building2, CircleDollarSign, ChevronRight, WalletCards } from "lucide-react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FinanceShell } from "@/components/keuangan/finance-ui";
import { createFinanceAccount, setFinanceOpeningBalance, getFinanceAccountSummary, getKeuanganContext, useFinanceRealtime, type FinanceAccount } from "@/features/keuangan";
import { formatFinanceMoney } from "@/features/keuangan/utils";
import { createClientId } from "@/lib/client-id";
import { listInvestorAdminPrincipals, listInvestorAdminOperators, setFinanceAccountRole } from "@/features/investor";
import { paths } from "@/routes/paths";

function accountTypeLabel(value: string) {
  if (value === "kas") return "Kas";
  if (value === "bank") return "Bank";
  if (value === "e_wallet") return "Dompet Digital";
  return "Lainnya";
}

export function FinanceAccountList() {
  useFinanceRealtime();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [accountCode, setAccountCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<FinanceAccount["jenis_akun"]>("kas");
  const [accountFunction, setAccountFunction] = useState<"operasional" | "investor" | "pengelola">("operasional");
  const [selectedInvestorId, setSelectedInvestorId] = useState("");
  const [selectedOperatorId, setSelectedOperatorId] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [openingDate, setOpeningDate] = useState(() => new Date().toISOString().slice(0, 10));
  const context = useQuery({ queryKey: ["keuangan", "context"], queryFn: getKeuanganContext, staleTime: 60_000 });
  const accounts = useQuery({
    queryKey: ["keuangan", "account-summary", context.data?.usahaId],
    queryFn: () => getFinanceAccountSummary(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId),
    staleTime: 10_000,
  });
  const investors = useQuery({
    queryKey: ["investor", "principals", context.data?.usahaId],
    queryFn: () => listInvestorAdminPrincipals(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId) && accountFunction === "investor",
  });
  const operators = useQuery({
    queryKey: ["investor", "operators", context.data?.usahaId],
    queryFn: () => listInvestorAdminOperators(context.data!.usahaId),
    enabled: Boolean(context.data?.usahaId) && accountFunction === "pengelola",
  });
  const openingBalanceValue = Number(openingBalance);

  useEffect(() => {
    if (accountFunction !== "investor" && selectedInvestorId) setSelectedInvestorId("");
    if (accountFunction !== "pengelola" && selectedOperatorId) setSelectedOperatorId("");
    if (accountFunction !== "operasional" && openingBalance) setOpeningBalance("");
  }, [accountFunction, selectedInvestorId, selectedOperatorId, openingBalance]);

  const canSubmitAccount = Boolean(
    accountCode.trim() &&
    accountName.trim() &&
    (accountFunction === "operasional" || (accountFunction === "investor" ? selectedInvestorId : selectedOperatorId)),
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!context.data?.usahaId) throw new Error("Usaha aktif belum tersedia.");
      const created = await createFinanceAccount(context.data.usahaId, {
        kodeAkun: accountCode,
        namaAkun: accountName,
        jenisAkun: accountType,
        mataUang: "IDR",
      });
      const akunKeuanganId = String((created as { akun_keuangan_id?: string }).akun_keuangan_id ?? "");
      if (accountFunction !== "operasional") {
        if (!akunKeuanganId) throw new Error("ID akun baru tidak tersedia.");
        await setFinanceAccountRole({
          usahaId: context.data.usahaId,
          akunKeuanganId,
          fungsiAkun: accountFunction,
          investorId: accountFunction === "investor" ? selectedInvestorId : null,
          pengelolaAkunAdminId: accountFunction === "pengelola" ? selectedOperatorId : null,
          idempotencyKey: `set-account-role-${createClientId()}`,
          requestId: createClientId(),
        });
      }
      if (accountFunction === "operasional" && akunKeuanganId && Number.isFinite(openingBalanceValue) && openingBalanceValue > 0) {
        await setFinanceOpeningBalance(context.data.usahaId, {
          akunKeuanganId,
          nominal: openingBalanceValue,
          tanggalSaldoAwal: openingDate,
          catatan: "Saldo awal saat pembuatan akun",
        });
      }
      return created;
    },
    onSuccess: async () => {
      setAccountCode("");
      setAccountName("");
      setAccountType("kas");
      setAccountFunction("operasional");
      setSelectedInvestorId("");
      setSelectedOperatorId("");
      setOpeningBalance("");
      setCreateOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["keuangan", "account-summary", context.data?.usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["keuangan", "accounts", context.data?.usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["investor", "stakeholder-accounts", context.data?.usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["investor", "stakeholder-history", context.data?.usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["investor", "operational-account-summary", context.data?.usahaId] }),
      ]);
    },
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

  const active = accounts.data.accounts.filter((account) => account.status === "active" && account.fungsi_akun === "operasional");
  const investorBalances = accounts.data.accounts.filter((account) => account.fungsi_akun === "investor");
  const operatorBalances = accounts.data.accounts.filter((account) => account.fungsi_akun === "pengelola");
  const unknownRoleAccounts = accounts.data.accounts.filter((account) => account.fungsi_akun === "unknown");
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

      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Link to={paths.investorConfig} className="flex items-center justify-between gap-3 rounded-[18px] border border-primary/20 bg-primary/[0.035] px-3.5 py-3 hover:bg-primary/[0.06]">
          <span className="min-w-0"><span className="block text-[12px] font-bold">Konfigurasi Investor</span><span className="mt-1 block text-[10px] leading-4 text-muted-foreground">Atur akun saldo Investor/Pengelola, persentase, cadangan, dan rentang periode.</span></span>
          <ChevronRight className="size-4 shrink-0 text-primary" />
        </Link>
        <Link to={paths.investor} className="flex items-center justify-between gap-3 rounded-[18px] border border-border/60 bg-card px-3.5 py-3 hover:bg-muted/30">
          <span className="min-w-0"><span className="block text-[12px] font-bold">Buka Portal Investor</span><span className="mt-1 block text-[10px] leading-4 text-muted-foreground">Lihat hak hasil, histori, saldo fisik, dan pencatatan transfer.</span></span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      </section>

      <section className="rounded-[20px] border border-border/60 bg-card p-3.5 shadow-[0_4px_16px_rgba(30,68,57,.04)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold">Akun Uang Baru</h2>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Pilih fungsi akun, jenis tempat uang, dan tempatkan saldo awal (opsional) dalam satu langkah.</p>
          </div>
          <Button type="button" variant="outline" className="h-9 shrink-0 rounded-xl text-[10px]" onClick={() => setCreateOpen((open) => !open)}>
            {createOpen ? "Tutup" : "Tambah akun"}
          </Button>
        </div>
        {createOpen ? (
          <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="finance-account-function" className="text-[10px] font-semibold">Fungsi akun</label>
                <select id="finance-account-function" value={accountFunction} onChange={(event) => setAccountFunction(event.target.value as typeof accountFunction)} className="h-10 w-full rounded-xl border bg-card px-3 text-xs">
                  <option value="operasional">Operasional (uang usaha)</option>
                  <option value="investor">Investor (holding hasil investor)</option>
                  <option value="pengelola">Pengelola (holding hasil pengelola)</option>
                </select>
              </div>
              <div className="space-y-1"><label htmlFor="finance-account-kind" className="text-[10px] font-semibold">Jenis tempat uang</label><select id="finance-account-kind" value={accountType} onChange={(event) => setAccountType(event.target.value as FinanceAccount["jenis_akun"])} className="h-10 w-full rounded-xl border bg-card px-3 text-xs"><option value="kas">Kas</option><option value="bank">Bank</option><option value="e_wallet">Dompet Digital</option><option value="lainnya">Lainnya</option></select></div>
            </div>
            {accountFunction === "investor" ? (
              <div className="space-y-1">
                <label htmlFor="finance-account-investor" className="text-[10px] font-semibold">Pemilik akun (Investor)</label>
                <select id="finance-account-investor" value={selectedInvestorId} onChange={(event) => setSelectedInvestorId(event.target.value)} className="h-10 w-full rounded-xl border bg-card px-3 text-xs">
                  <option value="">Pilih investor…</option>
                  {(investors.data ?? []).map((investor) => (
                    <option key={investor.investorId} value={investor.investorId}>{investor.namaTampilan}</option>
                  ))}
                </select>
                {investors.data && !investors.data.length ? <p className="text-[10px] text-amber-700">Belum ada investor aktif. Tambahkan lewat Konfigurasi Investor terlebih dahulu.</p> : null}
              </div>
            ) : null}
            {accountFunction === "pengelola" ? (
              <div className="space-y-1">
                <label htmlFor="finance-account-operator" className="text-[10px] font-semibold">Pemilik akun (Pengelola)</label>
                <select id="finance-account-operator" value={selectedOperatorId} onChange={(event) => setSelectedOperatorId(event.target.value)} className="h-10 w-full rounded-xl border bg-card px-3 text-xs">
                  <option value="">Pilih pengelola…</option>
                  {(operators.data?.operators ?? []).map((operator) => (
                    <option key={operator.akun_admin_id} value={operator.akun_admin_id}>{operator.nama_tampilan} · {operator.role}</option>
                  ))}
                </select>
                {operators.data && !operators.data.operators.length ? <p className="text-[10px] text-amber-700">Belum ada pengelola aktif pada usaha ini.</p> : null}
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1"><label htmlFor="finance-account-code" className="text-[10px] font-semibold">Kode akun</label><Input id="finance-account-code" value={accountCode} onChange={(event) => setAccountCode(event.target.value.toUpperCase())} placeholder="Contoh: KAS-UTAMA" maxLength={40} className="h-10 rounded-xl text-xs" /></div>
              <div className="space-y-1"><label htmlFor="finance-account-name" className="text-[10px] font-semibold">Nama akun</label><Input id="finance-account-name" value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder={accountFunction === "operasional" ? "Contoh: Kas Usaha" : accountFunction === "investor" ? "Contoh: Rekening Investor" : "Contoh: Rekening Pengelola"} maxLength={120} className="h-10 rounded-xl text-xs" /></div>
            </div>
            {accountFunction === "operasional" ? (
              <div className="rounded-xl border border-primary/20 bg-primary/[0.035] p-3">
                <p className="text-[10px] font-semibold">Penempatan saldo awal (opsional)</p>
                <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">Uang modal kerja yang sudah ada sebelum sistem dipakai. Kosongkan bila akun mulai dari nol.</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1"><label htmlFor="finance-account-opening-balance" className="text-[10px] font-semibold">Nominal saldo awal</label><Input id="finance-account-opening-balance" type="number" inputMode="decimal" min="0" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} placeholder="0" className="h-10 rounded-xl text-xs" /></div>
                  <div className="space-y-1"><label htmlFor="finance-account-opening-date" className="text-[10px] font-semibold">Tanggal saldo awal</label><Input id="finance-account-opening-date" type="date" value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} className="h-10 rounded-xl text-xs" /></div>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-[10px] leading-4 text-blue-900">Akun holding Investor/Pengelola mulai dari saldo nol; isinya datang dari pembagian hasil periode atau transfer hak. Saldo awal hanya untuk akun operasional.</p>
            )}
            <div className="flex justify-end">
              <Button type="button" className="h-10 rounded-xl text-xs" disabled={createMutation.isPending || !canSubmitAccount} onClick={() => createMutation.mutate()}>{createMutation.isPending ? "Menyimpan…" : "Buat Akun"}</Button>
            </div>
            {createMutation.error ? <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-[10px] text-destructive">{createMutation.error instanceof Error ? createMutation.error.message : "Akun gagal dibuat."}</p> : null}
          </div>
        ) : null}
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
        {active.map((account) => (
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

      {active.length === 0 ? (
        <Card className="rounded-[22px] border-dashed">
          <CardContent className="p-7 text-center">
            <WalletCards className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">Belum ada akun operasional</p>
            <p className="mt-1 text-xs text-muted-foreground">Buat akun Kas, Bank, atau Dompet Digital pada setup Keuangan sebelum mencatat pembayaran dan pengeluaran usaha.</p>
            <Link to={paths.keuangan} className="mt-4 inline-flex rounded-xl border px-4 py-2 text-sm font-semibold">Buka Keuangan</Link>
          </CardContent>
        </Card>
      ) : null}

      {unknownRoleAccounts.length > 0 ? (
        <Alert variant="destructive" className="rounded-[20px]">
          <AlertTitle>{unknownRoleAccounts.length} akun perlu verifikasi fungsi</AlertTitle>
          <AlertDescription>
            Akun ini tidak dimasukkan ke saldo operasional, Investor, atau Pengelola karena metadata fungsinya belum dapat dibaca. Periksa sumber data dan konfigurasi sebelum memakai akun untuk transaksi baru.
            <div className="mt-3 grid gap-2">
              {unknownRoleAccounts.map((account) => (
                <Link key={account.akun_keuangan_id} to={paths.keuangan + "/akun/" + account.akun_keuangan_id} className="rounded-lg border border-current/15 px-3 py-2 text-xs font-semibold">
                  {account.nama_akun} · {account.kode_akun} · {formatFinanceMoney(account.saldo, account.mata_uang)}
                </Link>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <Alert className="rounded-[20px] border-blue-100 bg-blue-50/60 text-blue-950 dark:border-blue-900/40 dark:bg-blue-950/15 dark:text-blue-100">
        <CircleDollarSign className="size-4" />
        <AlertTitle>Saldo pemilik dicatat terpisah</AlertTitle>
        <AlertDescription>
          Saldo Investor dan Pengelola adalah uang aktual pada rekening khusus mereka. Angka ini tidak termasuk total uang masuk/keluar operasional dan bukan pengganti hak alokasi yang belum dibayarkan.
        </AlertDescription>
      </Alert>

      {[
        { title: "Saldo Investor (tercatat)", description: "Saldo aktual pada akun yang sudah ditetapkan ke pool Investor.", rows: investorBalances, role: "investor" as const },
        { title: "Saldo Pengelola (tercatat)", description: "Saldo aktual pada akun yang sudah ditetapkan ke pool Pengelola.", rows: operatorBalances, role: "pengelola" as const },
      ].map((section) => (
        <section key={section.role} className="space-y-2.5">
          <div>
            <h2 className="text-sm font-bold tracking-tight">{section.title}</h2>
            <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{section.description}</p>
          </div>
          {section.rows.length ? (
            <div className="grid gap-2.5 md:grid-cols-2">
              {section.rows.map((account) => (
                <article key={account.akun_keuangan_id} className="rounded-[20px] border border-border/60 bg-card p-3.5 shadow-[0_4px_16px_rgba(30,68,57,.035)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={section.role === "investor"
                        ? "grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-200"
                        : "grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-200"}>
                        <WalletCards className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="break-words text-[13px] font-bold">{account.nama_akun}</p>
                        <p className="mt-0.5 text-[9px] text-muted-foreground">
                          {account.kode_akun} · {accountTypeLabel(account.jenis_akun)} · {account.mata_uang}
                        </p>
                      </div>
                    </div>
                    <Badge variant={account.status === "active" ? "default" : "outline"} className="shrink-0 rounded-full text-[9px]">
                      {account.status === "active" ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </div>
                  <div className="mt-3 rounded-2xl bg-slate-950 px-4 py-3.5 text-white dark:bg-slate-900">
                    <p className="text-[9px] text-white/60">Saldo {section.role === "investor" ? "Investor" : "Pengelola"} · {account.mata_uang}</p>
                    <p className="mt-1 break-words text-[22px] font-bold tracking-tight tabular-nums">
                      {formatFinanceMoney(account.saldo, account.mata_uang)}
                    </p>
                  </div>
                  <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
                    {account.status === "active"
                      ? "Saldo berasal dari saldo awal dan mutasi yang tercatat pada akun ini."
                      : "Akun nonaktif tetap ditampilkan agar saldo historis yang tercatat tidak tersembunyi."}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-[18px] border border-dashed border-border px-4 py-5 text-center text-[10px] text-muted-foreground">
              Belum ada akun dengan fungsi {section.role === "investor" ? "Saldo Investor" : "Saldo Pengelola"} pada usaha ini.
            </div>
          )}
        </section>
      ))}
    </FinanceShell>
  );
}
