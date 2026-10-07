import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronDown, WalletCards, WandSparkles, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FinanceAccount } from "@/features/keuangan";
import { cn } from "@/lib/utils";

type Props = {
  accounts: FinanceAccount[];
  amount: number;
  allocations: Record<string, string>;
  onAllocationsChange: (next: Record<string, string>) => void;
  selectedAccountId: string;
  onSelectedAccountChange: (accountId: string) => void;
  onProceed: () => void;
  disabled?: boolean;
  isPending?: boolean;
  setupHref: string;
};

const idr = new Intl.NumberFormat("id-ID");

function money(value: number) {
  return "Rp " + idr.format(Math.max(0, Number.isFinite(value) ? value : 0));
}

export function MaintenanceFinanceCashout({
  accounts,
  amount,
  allocations,
  onAllocationsChange,
  selectedAccountId,
  onSelectedAccountChange,
  onProceed,
  disabled = false,
  isPending = false,
  setupHref,
}: Props) {
  const [splitOpen, setSplitOpen] = useState(false);
  const activeAccounts = accounts.filter((account) => account.status === "active" && account.mata_uang === "IDR");

  const availableTotal = activeAccounts.reduce((sum, account) => sum + Math.max(0, Number(account.saldo)), 0);
  const allocatedTotal = Object.values(allocations).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  const remaining = Math.max(0, amount - allocatedTotal);
  const over = Math.max(0, allocatedTotal - amount);

  const allocationRows = useMemo(
    () =>
      activeAccounts.map((account) => ({
        account,
        value: allocations[account.akun_keuangan_id] ?? "",
        numericValue: Math.max(0, Number(allocations[account.akun_keuangan_id] || 0)),
      })),
    [activeAccounts, allocations],
  );

  const totalInsufficient = amount > 0 && availableTotal < amount;
  const ready =
    amount === 0 ||
    (remaining <= 0.000001 &&
      over <= 0.000001 &&
      activeAccounts.length > 0 &&
      !totalInsufficient &&
      allocationRows.every(
        ({ account, numericValue }) => numericValue <= Math.max(0, Number(account.saldo)) + 0.000001,
      ));

  const selectedAccount = activeAccounts.find((account) => account.akun_keuangan_id === selectedAccountId) ?? activeAccounts[0] ?? null;

  useEffect(() => {
    if (!selectedAccountId && activeAccounts[0]) {
      onSelectedAccountChange(activeAccounts[0].akun_keuangan_id);
    }
  }, [activeAccounts, onSelectedAccountChange, selectedAccountId]);

  useEffect(() => {
    if (!selectedAccount || amount <= 0 || Object.keys(allocations).length > 0) return;
    const available = Math.max(0, Number(selectedAccount.saldo));
    const take = Math.min(amount, available);
    if (take > 0) {
      onAllocationsChange({ [selectedAccount.akun_keuangan_id]: String(Math.round(take)) });
      if (take < amount) setSplitOpen(true);
    }
  }, [allocations, amount, onAllocationsChange, selectedAccount]);

  const handlePrimaryAccountChange = (accountId: string) => {
    onSelectedAccountChange(accountId);
    if (amount <= 0) {
      onAllocationsChange({});
      return;
    }
    const account = activeAccounts.find((item) => item.akun_keuangan_id === accountId);
    if (!account) return;
    const available = Math.max(0, Number(account.saldo));
    const take = Math.min(amount, available);
    onAllocationsChange(take > 0 ? { [accountId]: String(Math.round(take)) } : {});
    setSplitOpen(take < amount);
  };

  const changeAllocation = (accountId: string, value: string) => {
    if (value === "") {
      const next = { ...allocations };
      delete next[accountId];
      onAllocationsChange(next);
      return;
    }
    onAllocationsChange({
      ...allocations,
      [accountId]: value.replace(/[^0-9.]/g, ""),
    });
  };

  const autoAllocate = () => {
    let left = Math.max(0, amount);
    const next: Record<string, string> = {};
    for (const account of [...activeAccounts].sort((a, b) => Number(b.saldo) - Number(a.saldo))) {
      if (left <= 0.000001) break;
      const available = Math.max(0, Number(account.saldo));
      const take = Math.min(left, available);
      if (take > 0) {
        next[account.akun_keuangan_id] = String(Math.round(take));
        left -= take;
      }
    }
    onAllocationsChange(next);
  };

  const clearAllocations = () => onAllocationsChange({});

  if (activeAccounts.length === 0 && amount > 0) {
    return (
      <Alert variant="destructive" className="rounded-2xl">
        <AlertCircle className="size-4" />
        <AlertTitle>Belum ada akun uang aktif</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>Cash out tidak dapat dilakukan tanpa akun Kas, Bank, atau E-Wallet aktif.</p>
          <Button asChild variant="outline" size="sm" className="rounded-xl">
            <a href={setupHref}>
              Siapkan Akun Uang <ArrowRight />
            </a>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (amount === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-2xl bg-emerald-50/60 px-3.5 py-3 text-xs dark:bg-emerald-950/15">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
            <CheckCircle2 className="size-4" />
            <span>Tidak ada cash out</span>
          </div>
          <span className="font-semibold tabular-nums text-emerald-800 dark:text-emerald-100">{money(0)}</span>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/45 px-3.5 py-3 text-xs dark:border-emerald-900/30 dark:bg-emerald-950/10">
          <p className="font-semibold text-emerald-900 dark:text-emerald-100">Penyelesaian tanpa biaya</p>
          <p className="mt-0.5 leading-5 text-emerald-800/80 dark:text-emerald-200/80">Status perawatan tetap diselesaikan tanpa transaksi Finance.</p>
        </div>
        <Button type="button" className="h-12 w-full rounded-2xl" disabled={disabled || isPending} onClick={onProceed}>
          {isPending ? "Menyelesaikan..." : "Selesaikan Perawatan"}
          <ArrowRight />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold">Sumber Uang</p>
        <p className="text-xs text-muted-foreground">Akun yang digunakan untuk membayar biaya aktual.</p>
      </div>

      <Select value={selectedAccount?.akun_keuangan_id ?? ""} onValueChange={handlePrimaryAccountChange}>
        <SelectTrigger className="h-12 rounded-2xl border-border/70 bg-background text-left">
          <div className="flex min-w-0 items-center gap-2.5">
            <WalletCards className="size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <SelectValue placeholder="Pilih sumber uang" />
              {selectedAccount ? (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {selectedAccount.kode_akun} · Saldo {money(Number(selectedAccount.saldo))}
                </p>
              ) : null}
            </div>
          </div>
        </SelectTrigger>
        <SelectContent>
          {activeAccounts.map((account) => (
            <SelectItem key={account.akun_keuangan_id} value={account.akun_keuangan_id}>
              {account.nama_akun} · Saldo {money(Number(account.saldo))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center justify-between rounded-2xl bg-emerald-50/60 px-3.5 py-3 text-xs dark:bg-emerald-950/15">
        <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="size-4" />
          <span>Biaya aktual</span>
        </div>
        <span className="font-semibold tabular-nums text-emerald-800 dark:text-emerald-100">{money(amount)}</span>
      </div>

      {amount > 0 && selectedAccount ? (
        <div className="rounded-2xl border border-border/60 bg-background px-3.5 py-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Dialokasikan dari {selectedAccount.nama_akun}</span>
            <span className="font-semibold tabular-nums">{money(allocatedTotal)}</span>
          </div>
          {remaining > 0 ? (
            <p className="mt-1 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
              Masih kurang {money(remaining)} dari sumber uang.
            </p>
          ) : null}
          {over > 0 ? (
            <p className="mt-1 text-[11px] leading-5 text-destructive">
              Total alokasi melebihi biaya aktual sebesar {money(over)}.
            </p>
          ) : null}
        </div>
      ) : null}

      {activeAccounts.length > 1 ? (
        <div className="rounded-2xl border border-border/60">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
            onClick={() => setSplitOpen((value) => !value)}
            aria-expanded={splitOpen}
          >
            <span>
              <span className="block text-xs font-semibold">Bagikan ke beberapa akun</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">Gunakan bila satu akun tidak cukup atau pembayaran memang dibagi.</span>
            </span>
            <ChevronDown className={cn("size-4 shrink-0 transition-transform", splitOpen ? "rotate-180" : "")} />
          </button>

          {splitOpen ? (
            <div className="space-y-2 border-t px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">Pembagian aktual</p>
                <div className="flex gap-1.5">
                  <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-[11px]" onClick={autoAllocate}>
                    <WandSparkles className="size-3" />
                    Otomatis
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-[11px]" onClick={clearAllocations} disabled={allocatedTotal <= 0}>
                    <X className="size-3" />
                    Reset
                  </Button>
                </div>
              </div>
              {allocationRows.map(({ account, value, numericValue }) => {
                const available = Math.max(0, Number(account.saldo));
                const exceeds = numericValue > available + 0.000001;
                return (
                  <label key={account.akun_keuangan_id} className={cn("grid gap-1.5 rounded-xl border px-3 py-2.5", exceeds && "border-destructive/40 bg-destructive/[0.025]")}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-semibold">{account.nama_akun}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">Saldo {money(available)}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">Rp</span>
                      <Input
                        aria-label={"Alokasi " + account.nama_akun}
                        inputMode="decimal"
                        type="number"
                        min="0"
                        max={available}
                        step="1"
                        value={value}
                        onChange={(event) => changeAllocation(account.akun_keuangan_id, event.target.value)}
                        className="h-10 rounded-xl text-right font-semibold tabular-nums"
                        placeholder="0"
                      />
                    </div>
                    {exceeds ? <span className="text-[10px] font-medium text-destructive">Nominal melebihi saldo akun ini.</span> : null}
                  </label>
                );
              })}
              <div className="rounded-xl bg-muted/35 px-3 py-2 text-[11px] text-muted-foreground">
                Saldo gabungan {money(availableTotal)} · sisa {money(remaining)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/45 px-3.5 py-3 text-xs dark:border-emerald-900/30 dark:bg-emerald-950/10">
        <p className="font-semibold text-emerald-900 dark:text-emerald-100">Pengeluaran akan otomatis dicatat</p>
        <p className="mt-0.5 leading-5 text-emerald-800/80 dark:text-emerald-200/80">
          Cash out menjadi bagian dari penyelesaian perawatan dan tidak dijalankan sebagai transaksi terpisah.
        </p>
      </div>

      {totalInsufficient ? (
        <p className="text-xs font-medium text-destructive">Saldo gabungan belum cukup. Kekurangan {money(amount - availableTotal)}.</p>
      ) : null}

      <Button
        type="button"
        className="h-12 w-full rounded-2xl"
        disabled={disabled || !ready || isPending}
        onClick={onProceed}
      >
        {isPending ? "Menyelesaikan..." : amount > 0 ? "Selesaikan Perawatan" : "Selesaikan Perawatan"}
        <ArrowRight />
      </Button>
    </div>
  );
}
