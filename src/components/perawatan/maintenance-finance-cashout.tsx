import { useMemo } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, WalletCards, WandSparkles, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { FinanceAccount } from "@/features/keuangan";
import { cn } from "@/lib/utils";

type Props = {
  accounts: FinanceAccount[];
  amount: number;
  allocations: Record<string, string>;
  onAllocationsChange: (next: Record<string, string>) => void;
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
  onProceed,
  disabled = false,
  isPending = false,
  setupHref,
}: Props) {
  const activeAccounts = accounts.filter((account) => account.status === "active" && account.mata_uang === "IDR");
  const availableTotal = activeAccounts.reduce((sum, account) => sum + Math.max(0, Number(account.saldo)), 0);
  const allocatedTotal = Object.values(allocations).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  const remaining = Math.max(0, amount - allocatedTotal);
  const over = Math.max(0, allocatedTotal - amount);

  const allocationRows = useMemo(
    () => activeAccounts.map((account) => ({
      account,
      value: allocations[account.akun_keuangan_id] ?? "",
      numericValue: Math.max(0, Number(allocations[account.akun_keuangan_id] || 0)),
    })),
    [activeAccounts, allocations],
  );

  const coverageRatio = amount > 0 ? Math.min(100, (allocatedTotal / amount) * 100) : 100;
  const totalInsufficient = amount > 0 && availableTotal < amount;
  const ready = amount === 0 || (
    remaining <= 0.000001 &&
    over <= 0.000001 &&
    !totalInsufficient &&
    activeAccounts.length > 0 &&
    allocationRows.every(({ account, numericValue }) => numericValue <= Math.max(0, Number(account.saldo)) + 0.000001)
  );

  const changeAllocation = (accountId: string, value: string) => {
    if (value === "") {
      const next = { ...allocations };
      delete next[accountId];
      onAllocationsChange(next);
      return;
    }
    const next = { ...allocations, [accountId]: value.replace(/[^0-9.]/g, "") };
    onAllocationsChange(next);
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

  return (
    <Card className="rounded-[22px] border-primary/15 bg-card shadow-sm">
      <CardHeader className="space-y-1 p-4 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <WalletCards className="size-5 text-primary" />
          Bayar biaya aktual
        </CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">
          Pengeluaran dan cash out harus selesai dalam tindakan yang sama sebelum perawatan berstatus Selesai.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <div className="grid grid-cols-3 divide-x rounded-2xl bg-muted/30">
          <div className="px-3 py-3">
            <p className="text-[11px] text-muted-foreground">Biaya aktual</p>
            <p className="mt-1 text-sm font-bold tabular-nums">{money(amount)}</p>
          </div>
          <div className="px-3 py-3">
            <p className="text-[11px] text-muted-foreground">Dialokasikan</p>
            <p className="mt-1 text-sm font-bold tabular-nums">{money(allocatedTotal)}</p>
          </div>
          <div className="px-3 py-3">
            <p className="text-[11px] text-muted-foreground">Sisa</p>
            <p className={cn("mt-1 text-sm font-bold tabular-nums", remaining > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300")}>
              {money(remaining)}
            </p>
          </div>
        </div>

        {activeAccounts.length === 0 ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Belum ada akun uang aktif</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>Cash out tidak dapat dilakukan tanpa akun Kas, Bank, atau E-Wallet aktif.</p>
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <a href={setupHref}>Siapkan Akun Uang <ArrowRight /></a>
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {activeAccounts.length > 0 ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Sumber uang</p>
                <p className="text-[11px] text-muted-foreground">Saldo adalah dana yang dapat dipakai saat ini.</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={autoAllocate} disabled={amount <= 0}>
                  <WandSparkles className="size-3.5" />Bagi otomatis
                </Button>
                <Button type="button" variant="ghost" size="sm" className="rounded-xl" onClick={clearAllocations} disabled={allocatedTotal <= 0}>
                  <X className="size-3.5" />Reset
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              {allocationRows.map(({ account, value, numericValue }) => {
                const available = Math.max(0, Number(account.saldo));
                const exceeds = numericValue > available + 0.000001;
                const remainingAfter = Math.max(0, amount - (allocatedTotal - numericValue));
                const recommended = Math.min(available, remainingAfter);
                return (
                  <div key={account.akun_keuangan_id} className={cn(
                    "rounded-2xl border p-3",
                    value && !exceeds ? "border-primary/20 bg-primary/[0.02]" : "border-border/70",
                    exceeds ? "border-destructive/40 bg-destructive/[0.025]" : "",
                  )}>
                    <div className="flex items-start gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted/50 text-primary">
                        <WalletCards className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{account.nama_akun}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{account.kode_akun} · Saldo {money(available)}</p>
                          </div>
                          {value && !exceeds ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : null}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
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
                            placeholder={recommended > 0 ? idr.format(recommended) : "0"}
                          />
                        </div>
                        {exceeds ? (
                          <p className="mt-1.5 text-[11px] font-medium text-destructive">Nominal melebihi saldo akun ini. Gunakan akun lain atau kurangi alokasi.</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border bg-muted/20 p-3.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Kapasitas saldo gabungan</span>
                <span className="font-semibold tabular-nums">{money(availableTotal)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: coverageRatio + "%" }} />
              </div>
              {totalInsufficient ? (
                <p className="mt-2 text-xs font-medium text-destructive">
                  Saldo gabungan belum cukup. Kekurangan {money(amount - availableTotal)}. Cash out akan ditolak.
                </p>
              ) : remaining > 0 ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Masih ada {money(remaining)} yang belum memiliki sumber uang.
                </p>
              ) : null}
              {over > 0 ? (
                <p className="mt-2 text-xs font-medium text-destructive">Total alokasi melebihi biaya aktual sebesar {money(over)}.</p>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="rounded-2xl border border-primary/10 bg-primary/[0.025] p-3.5">
          <p className="text-xs font-semibold">Aturan cash out</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Satu pengeluaran dapat dibayar dari beberapa akun uang. Sistem memeriksa saldo aktual saat commit dan akan menolak seluruh tindakan bila dana tidak cukup.
          </p>
        </div>

        <Button
          type="button"
          className="h-12 w-full rounded-xl"
          disabled={disabled || !ready || isPending}
          onClick={onProceed}
        >
          {isPending ? "Mencatat pengeluaran & cash out…" : amount > 0 ? "Bayar & Selesaikan Perawatan" : "Selesaikan Perawatan"}
          <ArrowRight />
        </Button>
      </CardContent>
    </Card>
  );
}
