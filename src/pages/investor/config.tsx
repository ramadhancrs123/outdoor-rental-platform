import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, CircleAlert, ChevronDown, CreditCard, FileText, Home, Info, ReceiptText, Save, Settings2, UserRound } from "lucide-react";
import { Link } from "react-router";

import { useCurrentUsaha } from "@/app/current-usaha-context";
import { supabase } from "@/app/providers/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { paths } from "@/routes/paths";
import { createClientId } from "@/lib/client-id";
import { getFinanceAccountSummary } from "@/features/keuangan";
import {
  getInvestorAdminFinanceConfig,
  listInvestorAdminOperators,
  listInvestorAdminPrincipals,
  setFinanceAccountRole,
  setInvestorFinanceConfig,
} from "@/features/investor/service";

function uuid() {
  return createClientId();
}

function monthValue(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 7);
}

export function InvestorConfigPage() {
  const { current } = useCurrentUsaha();
  const queryClient = useQueryClient();
  const [selectedInvestorId, setSelectedInvestorId] = useState("");
  const [selectedOperatorId, setSelectedOperatorId] = useState("");
  const [roleAccountId, setRoleAccountId] = useState("");
  const [roleTarget, setRoleTarget] = useState<"investor" | "pengelola">("investor");
  const [roleMessage, setRoleMessage] = useState<string | null>(null);
  const [percentage, setPercentage] = useState("");
  const [reserve, setReserve] = useState("");
  const [effectiveMonth, setEffectiveMonth] = useState("");
  const [periodStartDay, setPeriodStartDay] = useState(1);
  const [periodEndDay, setPeriodEndDay] = useState(30);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [configInitializedFor, setConfigInitializedFor] = useState("");
  const configAttemptRef = useRef<{ signature: string; id: string } | null>(null);
  const roleAttemptRef = useRef<{ signature: string; id: string } | null>(null);

  const investors = useQuery({
    queryKey: ["investor", "admin", "principals", current?.usahaId],
    queryFn: () => listInvestorAdminPrincipals(current?.usahaId as string),
    enabled: Boolean(current?.usahaId),
  });

  const operators = useQuery({
    queryKey: ["investor", "admin", "operators", current?.usahaId],
    queryFn: () => listInvestorAdminOperators(current?.usahaId as string),
    enabled: Boolean(current?.usahaId),
    staleTime: 60_000,
  });

  const financeAccounts = useQuery({
    queryKey: ["keuangan", "account-summary", current?.usahaId],
    queryFn: () => getFinanceAccountSummary(current?.usahaId as string),
    enabled: Boolean(current?.usahaId),
    staleTime: 15_000,
  });

  const businessMeta = useQuery({
    queryKey: ["investor", "config-business-meta", current?.usahaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("usaha")
        .select("timezone")
        .eq("usaha_id", current?.usahaId as string)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Zona waktu Usaha aktif tidak dapat diverifikasi.");
      return { timezone: data.timezone || "Asia/Jakarta" };
    },
    enabled: Boolean(current?.usahaId),
    staleTime: 60_000,
  });
  const businessTimezone = businessMeta.data?.timezone ?? "Asia/Jakarta";

  const selected = investors.data?.find((item) => item.investorId === selectedInvestorId)
    ?? (investors.data?.length === 1 ? investors.data[0] : undefined);

  useEffect(() => {
    if (!selectedInvestorId && selected?.investorId) setSelectedInvestorId(selected.investorId);
  }, [selected?.investorId, selectedInvestorId]);

  const historyQuery = useQuery({
    queryKey: ["investor", "admin", "finance-config", current?.usahaId, selectedInvestorId],
    queryFn: () => getInvestorAdminFinanceConfig(current?.usahaId as string, selectedInvestorId),
    enabled: Boolean(current?.usahaId && selectedInvestorId),
  });

  const currentConfig = historyQuery.data?.current ?? null;

  const initialConfig = currentConfig
    ?? historyQuery.data?.history.find((item) => item.status === "active")
    ?? null;

  useEffect(() => {
    if (!selectedInvestorId || !historyQuery.isSuccess || !businessMeta.isSuccess || !operators.isSuccess || configInitializedFor === selectedInvestorId) return;

    if (initialConfig) {
      setSelectedOperatorId(initialConfig.pengelola_akun_admin_id ?? "");
      setPercentage(String(initialConfig.investor_percentage));
      setReserve(String(initialConfig.operational_reserve_amount));
      setEffectiveMonth(monthValue(initialConfig.effective_from));
      setPeriodStartDay(initialConfig.period_start_day);
      setPeriodEndDay(initialConfig.period_end_day);
    } else {
      // A first configuration has no saved operator. Offer an explicit choice;
      // auto-select only when exactly one eligible operator exists.
      setEffectiveMonth((value) => value || new Intl.DateTimeFormat("sv-SE", {
        timeZone: businessTimezone,
        year: "numeric",
        month: "2-digit",
      }).format(new Date()));
      if (operators.data?.operators.length === 1) {
        setSelectedOperatorId(operators.data.operators[0].akun_admin_id);
      } else {
        setSelectedOperatorId("");
      }
      setPercentage("");
      setReserve("");
      setPeriodStartDay(1);
      setPeriodEndDay(30);
    }
    setConfigInitializedFor(selectedInvestorId);
  }, [selectedInvestorId, historyQuery.isSuccess, configInitializedFor, initialConfig, operators.data, operators.isSuccess, businessMeta.isSuccess, businessTimezone]);

  const operatorAccountId = selectedOperatorId || currentConfig?.pengelola_akun_admin_id || null;
  const effectiveStartDate = effectiveMonth
    ? effectiveMonth + "-" + String(periodStartDay).padStart(2, "0")
    : "";
  const daysInEffectiveMonth = effectiveMonth
    ? new Date(Number(effectiveMonth.slice(0, 4)), Number(effectiveMonth.slice(5, 7)), 0).getDate()
    : 31;


  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!current?.usahaId || !selectedInvestorId) throw new Error("Investor belum dipilih.");
      if (!operatorAccountId) throw new Error("Pilih pengelola yang aktif pada usaha ini.");
      if (!effectiveMonth) throw new Error("Periode berlaku belum dipilih.");
      if (percentage.trim() === "" || !Number.isFinite(Number(percentage)) || Number(percentage) < 0 || Number(percentage) > 100) {
        throw new Error("Persentase harus diisi dengan angka dari 0 sampai 100.");
      }
      if (reserve.trim() === "" || !Number.isFinite(Number(reserve)) || Number(reserve) < 0) {
        throw new Error("Cadangan operasional harus diisi dengan nominal nol atau lebih.");
      }
      if (periodStartDay < 1 || periodStartDay > daysInEffectiveMonth || periodEndDay < periodStartDay || periodEndDay > 31) {
        throw new Error("Rentang periode tidak valid untuk bulan yang dipilih.");
      }

      const signature = JSON.stringify({
        usahaId: current.usahaId,
        investorId: selectedInvestorId,
        pengelolaAkunAdminId: operatorAccountId,
        investorPercentage: Number(percentage),
        operationalReserveAmount: Number(reserve),
        periodStartDay,
        periodEndDay,
        effectiveFrom: effectiveStartDate,
      });
      if (!configAttemptRef.current || configAttemptRef.current.signature !== signature) {
        configAttemptRef.current = { signature, id: uuid() };
      }

      return setInvestorFinanceConfig({
        usahaId: current.usahaId,
        investorId: selectedInvestorId,
        pengelolaAkunAdminId: operatorAccountId,
        investorPercentage: Number(percentage),
        operationalReserveAmount: Number(reserve),
        periodStartDay,
        periodEndDay,
        effectiveFrom: effectiveStartDate,
        idempotencyKey: "investor-finance-config-" + configAttemptRef.current.id,
        requestId: uuid(),
      });
    },
    onSuccess: async () => {
      configAttemptRef.current = null;
      setStatusMessage("Konfigurasi investor tersimpan dan berlaku sesuai tanggal efektif.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["investor", "admin", "finance-config", current?.usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["investor", "admin", "principals", current?.usahaId] }),
      ]);
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : "Konfigurasi gagal disimpan.");
    },
  });

  const accountRoleMutation = useMutation({
    mutationFn: async () => {
      if (!current?.usahaId || !roleAccountId) throw new Error("Pilih akun uang terlebih dahulu.");
      if (roleTarget === "investor" && !selectedInvestorId) throw new Error("Pilih Investor terlebih dahulu.");
      if (roleTarget === "pengelola" && !operatorAccountId) throw new Error("Pilih Pengelola terlebih dahulu.");
      const candidate = financeAccounts.data?.accounts.find((account) => account.akun_keuangan_id === roleAccountId);
      if (!candidate || candidate.status !== "active") throw new Error("Akun uang aktif tidak ditemukan.");
      if (
        Number(candidate.saldo_awal) !== 0 ||
        Number(candidate.uang_masuk) !== 0 ||
        Number(candidate.uang_keluar) !== 0
      ) {
        throw new Error("Akun yang memiliki saldo awal atau mutasi tidak boleh dialihfungsikan. Buat akun baru untuk pool tujuan.");
      }

      const signature = JSON.stringify({
        usahaId: current.usahaId,
        akunKeuanganId: roleAccountId,
        fungsiAkun: roleTarget,
        investorId: roleTarget === "investor" ? selectedInvestorId : null,
        pengelolaAkunAdminId: roleTarget === "pengelola" ? operatorAccountId : null,
      });
      if (!roleAttemptRef.current || roleAttemptRef.current.signature !== signature) {
        roleAttemptRef.current = { signature, id: uuid() };
      }

      return setFinanceAccountRole({
        usahaId: current.usahaId,
        akunKeuanganId: roleAccountId,
        fungsiAkun: roleTarget,
        investorId: roleTarget === "investor" ? selectedInvestorId : null,
        pengelolaAkunAdminId: roleTarget === "pengelola" ? operatorAccountId : null,
        idempotencyKey: "finance-account-role-" + roleAttemptRef.current.id,
        requestId: uuid(),
      });
    },
    onSuccess: async () => {
      roleAttemptRef.current = null;
      setRoleMessage("Fungsi akun berhasil diselaraskan. Saldo operasional tetap terpisah dari saldo hasil.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["keuangan", "account-summary", current?.usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["keuangan", "accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["investor", "stakeholder-accounts", current?.usahaId] }),
      ]);
    },
    onError: (error) => setRoleMessage(error instanceof Error ? error.message : "Fungsi akun gagal diperbarui."),
  });

  if (!current?.usahaId) {
    return <div className="p-5 text-sm text-muted-foreground">Usaha aktif belum tersedia.</div>;
  }

  const percentageNumber = Number(percentage);
  const reserveNumber = Number(reserve);
  const invalid =
    !selectedInvestorId ||
    !effectiveMonth ||
    percentage.trim() === "" ||
    !Number.isFinite(percentageNumber) ||
    percentageNumber < 0 ||
    percentageNumber > 100 ||
    reserve.trim() === "" ||
    !Number.isFinite(reserveNumber) ||
    reserveNumber < 0 ||
    periodStartDay < 1 ||
    periodStartDay > daysInEffectiveMonth ||
    periodEndDay < periodStartDay ||
    periodEndDay > 31 ||
    !operatorAccountId ||
    operators.isLoading ||
    (operators.isSuccess && operators.data.operators.length === 0);

  return (
    <div className="min-h-svh bg-[#f5f7f6]">
      <div className="mx-auto w-full max-w-[760px] px-3 pb-28 pt-3 sm:px-5 md:pb-10 md:pt-6">
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-950 text-white shadow-sm">
              <span className="text-[11px] font-extrabold">A</span>
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight">Akasha</p>
              <p className="text-[10px] font-medium text-slate-500">Admin</p>
            </div>
          </div>
          <Link to={paths.keuangan + "/akun"} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-700" aria-label="Kembali ke Akun Uang">
            Keuangan
          </Link>
        </header>

        <section className="mb-3">
          <h1 className="text-[19px] font-bold tracking-tight text-slate-950 sm:text-[23px]">Konfigurasi Investor</h1>
          <p className="mt-1 text-[10px] leading-4 text-slate-500 sm:text-xs">
            Atur persentase bagi hasil, cadangan operasional, dan periode efektif tanpa mengubah fakta Finance.
          </p>
        </section>

        {investors.data && investors.data.length > 1 ? (
          <Card className="mb-3 rounded-[18px] border-slate-200/80 bg-white shadow-[0_3px_14px_rgba(30,68,57,.035)]">
            <CardContent className="p-3">
              <Label htmlFor="investor-selector" className="text-[10px] font-semibold text-slate-600">Investor</Label>
              <div className="relative mt-1.5">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <select
                  id="investor-selector"
                  value={selectedInvestorId}
                  onChange={(event) => {
                    setConfigInitializedFor("");
                    setSelectedInvestorId(event.target.value);
                    setStatusMessage(null);
                  }}
                  className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-[11px] font-semibold text-slate-800 outline-none ring-offset-white focus:ring-2 focus:ring-slate-900/10"
                >
                  {investors.data.map((item) => (
                    <option key={item.investorId} value={item.investorId}>{item.namaTampilan}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card className="mb-3 rounded-[18px] border-slate-200/80 bg-white shadow-[0_3px_14px_rgba(30,68,57,.035)]">
          <CardContent className="p-3">
            <Label htmlFor="investor-operator" className="text-[10px] font-semibold text-slate-600">Pengelola Usaha</Label>
            <p className="mt-1 text-[9px] leading-4 text-slate-500">Dipakai untuk mencatat alokasi hasil pengelola. Pilihan ini tidak mengubah pengeluaran operasional.</p>
            <select
              id="investor-operator"
              value={operatorAccountId ?? ""}
              onChange={(event) => setSelectedOperatorId(event.target.value)}
              disabled={operators.isLoading || !operators.data?.operators.length}
              className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-100"
            >
              <option value="">Pilih pengelola…</option>
              {(operators.data?.operators ?? []).map((item) => (
                <option key={item.akun_admin_id} value={item.akun_admin_id}>
                  {item.nama_tampilan} · {item.role}
                </option>
              ))}
            </select>
            {operators.error ? <p className="mt-1.5 text-[9px] text-red-600">{operators.error instanceof Error ? operators.error.message : "Daftar pengelola gagal dimuat."}</p> : null}
            {operators.data?.operators.length === 0 ? <p className="mt-1.5 text-[9px] text-amber-700">Belum ada admin aktif yang menjadi anggota usaha ini.</p> : null}
          </CardContent>
        </Card>

        <Card className="mb-3 rounded-[18px] border-slate-200/80 bg-white shadow-[0_3px_14px_rgba(30,68,57,.035)]">
          <CardContent className="p-3">
            <p className="text-[12px] font-bold text-slate-900">Pemisahan Saldo Hasil</p>
            <p className="mt-1 text-[9px] leading-4 text-slate-500">
              Kaitkan akun uang yang masih kosong ke Investor atau Pengelola. Akun yang sudah memiliki saldo awal atau mutasi tidak dapat dialihfungsikan agar histori uang tidak berubah makna.
            </p>
            <div className="mt-3">
              <Label htmlFor="stakeholder-role" className="text-[10px] font-semibold text-slate-600">Pool tujuan</Label>
              <select
                id="stakeholder-role"
                value={roleTarget}
                onChange={(event) => setRoleTarget(event.target.value as "investor" | "pengelola")}
                className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-800"
              >
                <option value="investor">Saldo Investor</option>
                <option value="pengelola">Saldo Pengelola</option>
              </select>
            </div>
            <div className="mt-3">
              <Label htmlFor="stakeholder-account" className="text-[10px] font-semibold text-slate-600">Akun uang kosong</Label>
              <select
                id="stakeholder-account"
                value={roleAccountId}
                onChange={(event) => setRoleAccountId(event.target.value)}
                disabled={financeAccounts.isLoading || !financeAccounts.data?.accounts.length}
                className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-800 disabled:bg-slate-100"
              >
                <option value="">Pilih akun uang…</option>
                {(financeAccounts.data?.accounts ?? [])
                  .filter((account) =>
                    account.status === "active" &&
                    Number(account.saldo_awal) === 0 &&
                    Number(account.uang_masuk) === 0 &&
                    Number(account.uang_keluar) === 0
                  )
                  .map((account) => (
                    <option key={account.akun_keuangan_id} value={account.akun_keuangan_id}>
                      {account.nama_akun} · {account.kode_akun} · {account.fungsi_akun ?? "operasional"}
                    </option>
                  ))}
              </select>
              {financeAccounts.error ? <p className="mt-1.5 text-[9px] text-red-600">{financeAccounts.error instanceof Error ? financeAccounts.error.message : "Daftar akun uang gagal dimuat."}</p> : null}
              {financeAccounts.data && !financeAccounts.data.accounts.some((account) =>
                account.status === "active" &&
                Number(account.saldo_awal) === 0 &&
                Number(account.uang_masuk) === 0 &&
                Number(account.uang_keluar) === 0
              ) ? <p className="mt-1.5 text-[9px] text-amber-700">Tidak ada akun kosong yang aman untuk dialihfungsikan. Buat akun baru dari halaman Keuangan.</p> : null}
            </div>
            <Button
              type="button"
              className="mt-3 h-10 w-full rounded-xl bg-[#10231f] text-[10px] font-semibold text-white hover:bg-[#10231f]/90"
              disabled={
                accountRoleMutation.isPending ||
                !roleAccountId ||
                (roleTarget === "investor" ? !selectedInvestorId : !operatorAccountId) ||
                financeAccounts.isLoading
              }
              onClick={() => accountRoleMutation.mutate()}
            >
              {accountRoleMutation.isPending ? "Menyelaraskan akun…" : "Tetapkan Fungsi Akun"}
            </Button>
            {roleMessage ? <p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[9px] leading-4 text-slate-700">{roleMessage}</p> : null}
          </CardContent>
        </Card>

        {businessMeta.error ? (
          <div role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[10px] leading-4 text-red-800">
            Zona waktu usaha belum dapat diverifikasi. Konfigurasi rentang tanggal belum siap disimpan; coba muat ulang halaman.
          </div>
        ) : null}

        {statusMessage ? (
          <div className={`mb-3 flex items-start gap-2 rounded-2xl border px-3 py-2.5 text-[10px] ${saveMutation.isError ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-100 bg-emerald-50 text-emerald-800"}`}>
            {saveMutation.isError
              ? <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />}
            <p>{statusMessage}</p>
          </div>
        ) : null}

        {!operatorAccountId ? (
          <div className="mb-3 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[10px] text-amber-800">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <p>Akun pengelola belum dikonfigurasi. Simpan konfigurasi dinonaktifkan sampai dependency ini tersedia.</p>
          </div>
        ) : null}

        <div className="space-y-2.5">
          <Card className="rounded-[20px] border-slate-200/80 bg-white shadow-[0_4px_16px_rgba(30,68,57,.04)]">
            <CardContent className="p-3.5 sm:p-4">
              <p className="text-[13px] font-bold text-slate-900">Partisipasi Investor</p>
              <p className="mt-1 text-[9px] leading-4 text-slate-500">Persentase bagi hasil yang efektif untuk investor terpilih.</p>
              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <Label htmlFor="investor-percentage" className="text-[9px] text-slate-500">Persentase Bagi Hasil</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    id="investor-percentage"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    type="number"
                    value={percentage}
                    onChange={(event) => setPercentage(event.target.value)}
                    className="h-9 border-0 px-0 text-[17px] font-bold shadow-none focus-visible:ring-0"
                  />
                  <span className="text-sm font-semibold text-slate-500">%</span>
                </div>
              </div>
              <p className="mt-2 text-[9px] text-slate-400">Mulai berlaku pada awal periode yang dipilih. Periode yang sudah ditutup tetap terkunci.</p>
            </CardContent>
          </Card>

          <Card className="rounded-[20px] border-slate-200/80 bg-white shadow-[0_4px_16px_rgba(30,68,57,.04)]">
            <CardContent className="p-3.5 sm:p-4">
              <p className="text-[13px] font-bold text-slate-900">Cadangan Operasional</p>
              <div className="mt-3">
                <Label htmlFor="reserve-type" className="text-[9px] text-slate-500">Tipe Cadangan</Label>
                <div className="relative mt-1">
                  <select id="reserve-type" value="fixed" disabled className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 pr-9 text-[11px] font-medium text-slate-800">
                    <option value="fixed">Nominal Tetap</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 px-3 py-2.5">
                <Label htmlFor="reserve-amount" className="text-[9px] text-slate-500">Nilai Cadangan</Label>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-slate-500">Rp</span>
                  <Input
                    id="reserve-amount"
                    inputMode="numeric"
                    min="0"
                    step="1000"
                    type="number"
                    value={reserve}
                    onChange={(event) => setReserve(event.target.value)}
                    className="h-9 border-0 px-0 text-[15px] font-bold shadow-none focus-visible:ring-0"
                  />
                </div>
              </div>
              <p className="mt-2 text-[9px] leading-4 text-slate-400">Saldo minimum yang harus tersisa di akun usaha setelah periode ditutup.</p>
            </CardContent>
          </Card>

          <Card className="rounded-[20px] border-slate-200/80 bg-white shadow-[0_4px_16px_rgba(30,68,57,.04)]">
            <CardContent className="p-3.5 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-bold text-slate-900">Periode Berlaku</p>
                  <p className="mt-1 text-[9px] text-slate-500">Perubahan efektif secara temporal; histori periode tertutup tetap.</p>
                </div>
                <CalendarDays className="size-4 text-slate-400" />
              </div>
              <div className="mt-3">
                <Label htmlFor="effective-month" className="text-[9px] text-slate-500">Bulan Efektif</Label>
                <Input id="effective-month" type="month" value={effectiveMonth} onChange={(event) => setEffectiveMonth(event.target.value)} className="mt-1 h-10 text-[11px]" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="period-start-day" className="text-[9px] text-slate-500">Tanggal Mulai Periode</Label>
                  <Input
                    id="period-start-day"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={daysInEffectiveMonth}
                    step={1}
                    value={periodStartDay}
                    onChange={(event) => setPeriodStartDay(Number(event.target.value))}
                    className="mt-1 h-10 text-[11px]"
                  />
                  <p className="mt-1 text-[9px] text-slate-400">Tanggal efektif: {effectiveStartDate || "—"}</p>
                </div>
                <div>
                  <Label htmlFor="period-end-day" className="text-[9px] text-slate-500">Tanggal Akhir Periode</Label>
                  <Input
                    id="period-end-day"
                    type="number"
                    inputMode="numeric"
                    min={periodStartDay}
                    max={31}
                    step={1}
                    value={periodEndDay}
                    onChange={(event) => setPeriodEndDay(Number(event.target.value))}
                    className="mt-1 h-10 text-[11px]"
                  />
                  <p className="mt-1 text-[9px] text-slate-400">Tanggal akhir berlaku termasuk hari ini.</p>
                </div>
              </div>
              {periodStartDay > daysInEffectiveMonth || periodEndDay < periodStartDay || periodEndDay > 31 ? (
                <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[9px] leading-4 text-amber-800">
                  Rentang periode tidak valid. Tanggal mulai harus ada pada bulan efektif, sedangkan tanggal akhir harus sama atau setelah tanggal mulai.
                </p>
              ) : null}
              <div className="mt-2 rounded-xl bg-blue-50 px-3 py-2.5 text-[9px] leading-4 text-blue-700">
                <div className="flex gap-2">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  <p>Perubahan konfigurasi akan berlaku mulai periode yang dipilih. Periode yang sudah ditutup tidak akan berubah.</p>
                </div>
              </div>
            </CardContent>
          </Card>

        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:sticky sm:bottom-4">
          <Button type="button" variant="outline" className="h-11 rounded-xl bg-white text-[11px] font-semibold" onClick={() => window.history.back()}>
            Batal
          </Button>
          <Button
            type="button"
            className="h-11 rounded-xl bg-[#10231f] text-[11px] font-semibold text-white shadow-sm hover:bg-[#10231f]/90"
            disabled={invalid || saveMutation.isPending || !businessMeta.isSuccess || !operators.isSuccess}
            onClick={() => saveMutation.mutate()}
          >
            <Save className="mr-1.5 size-3.5" />
            {saveMutation.isPending ? "Menyimpan…" : "Simpan Perubahan"}
          </Button>
        </div>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/96 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 backdrop-blur-xl sm:hidden" aria-label="Navigasi Keuangan">
          <div className="mx-auto grid max-w-[430px] grid-cols-5 gap-1">
            {[
              { label: "Beranda", href: "/dashboard", icon: Home },
              { label: "Pembayaran", href: "/keuangan/pembayaran", icon: ReceiptText },
              { label: "Pengeluaran", href: "/keuangan/pengeluaran", icon: FileText },
              { label: "Transaksi", href: "/keuangan/transaksi", icon: CreditCard },
              { label: "Konfigurasi", href: "/keuangan/investor", icon: Settings2 },
            ].map((item) => {
              const Icon = item.icon;
              const active = item.href === "/keuangan/investor";
              return (
                <Link
                  key={item.label}
                  to={item.href}
                  className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[8px] font-semibold ${active ? "bg-emerald-50 text-emerald-700" : "text-slate-400"}`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
        {historyQuery.isPending || investors.isPending ? (
          <p className="mt-3 text-center text-[9px] text-slate-400">Memuat konfigurasi investor…</p>
        ) : null}
        {historyQuery.error ? (
          <p className="mt-3 text-center text-[9px] text-amber-600">Riwayat konfigurasi belum dapat dibaca dari Finance.</p>
        ) : null}
      </div>
    </div>
  );
}
