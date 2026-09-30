import * as React from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowUpRight, CalendarDays, CheckCircle2, CircleAlert, Clock3, FileText, LockKeyhole, ShieldCheck, WalletCards } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function FinanceShell({
  eyebrow = "Keuangan",
  title,
  subtitle,
  children,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-24">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/75">{eyebrow}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

export function FinanceStatus({
  status,
  tone = "neutral",
}: {
  status: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const classes = {
    neutral: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-300",
    warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-300",
    danger: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/35 dark:text-rose-300",
    info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/35 dark:text-sky-300",
  }[tone];
  return (
    <Badge variant="outline" className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", classes)}>
      {status}
    </Badge>
  );
}

export function AmountDisplay({
  amount,
  label,
  direction,
  compact = false,
}: {
  amount: string | number;
  label?: string;
  direction?: "income" | "expense";
  compact?: boolean;
}) {
  const value = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(amount) || 0);
  return (
    <div className="min-w-0">
      {label ? <p className="text-[11px] font-medium text-muted-foreground">{label}</p> : null}
      <p className={cn("font-bold tracking-tight tabular-nums", compact ? "text-lg" : "text-2xl sm:text-3xl", direction === "expense" ? "text-rose-700 dark:text-rose-300" : direction === "income" ? "text-emerald-700 dark:text-emerald-300" : "text-foreground")}>
        {direction === "income" ? "+" : direction === "expense" ? "−" : ""}{value.replace(/^[-+]/, "")}
      </p>
    </div>
  );
}

export function SourcePreview({
  type,
  number,
  renter,
  period,
  meta,
}: {
  type: "Reservasi" | "Penyewaan" | "Purchase" | "Maintenance";
  number: string;
  renter?: string | null;
  period?: string | null;
  meta?: string | null;
}) {
  const Icon = type === "Reservasi" ? CalendarDays : type === "Penyewaan" ? WalletCards : FileText;
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{type}</p>
          <p className="mt-1 text-sm font-bold">{number}</p>
          {renter ? <p className="mt-0.5 text-sm text-muted-foreground">{renter}</p> : null}
          {period ? <p className="mt-1 text-xs text-muted-foreground">{period}</p> : null}
          {meta ? <p className="mt-1 text-xs text-muted-foreground">{meta}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function FinanceNavNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border bg-card/80 px-3 py-2 text-xs text-muted-foreground shadow-sm">
      <LockKeyhole className="size-3.5 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function FinanceStateScreen({
  icon: Icon,
  tone,
  title,
  description,
  primary,
  secondary,
}: {
  icon: typeof CheckCircle2;
  tone: "success" | "warning" | "danger";
  title: string;
  description: string;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
}) {
  const iconClass = {
    success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300",
    warning: "bg-amber-50 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300",
    danger: "bg-rose-50 text-rose-700 dark:bg-rose-950/35 dark:text-rose-300",
  }[tone];
  return (
    <div className="mx-auto flex min-h-[72vh] w-full max-w-xl items-center justify-center pb-24">
      <div className="w-full rounded-[28px] border bg-card px-6 py-10 text-center shadow-xl shadow-black/5 sm:px-10">
        <div className={cn("mx-auto grid size-20 place-items-center rounded-full", iconClass)}>
          <Icon className="size-9" aria-hidden="true" />
        </div>
        <h2 className="mt-7 text-2xl font-bold tracking-tight">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="mt-7 grid gap-3">{primary}{secondary}</div>
      </div>
    </div>
  );
}

export function FinanceMetric({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: typeof ArrowUpRight;
  tone?: "neutral" | "success" | "danger" | "info";
}) {
  const iconClass = {
    neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300",
    danger: "bg-rose-100 text-rose-700 dark:bg-rose-950/35 dark:text-rose-300",
    info: "bg-sky-100 text-sky-700 dark:bg-sky-950/35 dark:text-sky-300",
  }[tone];
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
        </div>
        <div className={cn("grid size-10 place-items-center rounded-xl", iconClass)}><Icon className="size-4" aria-hidden="true" /></div>
      </div>
    </div>
  );
}

import type { FinancePeriodPreset, FinancePeriodSelection } from "@/features/keuangan";
import { formatFinanceMoney } from "@/features/keuangan";

export function FinancePeriodBar({
  timezone,
  selection,
  onPreset,
  onCustomStart,
  onCustomEnd,
  serverPeriod,
}: {
  timezone: string;
  selection: FinancePeriodSelection;
  onPreset: (preset: FinancePeriodPreset) => void;
  onCustomStart: (value: string) => void;
  onCustomEnd: (value: string) => void;
  serverPeriod?: { startDate: string; endDateExclusive: string; timezone: string } | null;
}) {
  const labels: Array<[FinancePeriodPreset, string]> = [
    ["today", "Hari ini"],
    ["week", "Minggu ini"],
    ["month", "Bulan ini"],
    ["custom", "Custom"],
  ];

  return (
    <Card className="overflow-hidden border-primary/10 shadow-sm">
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-muted/40 p-1">
          {labels.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={selection.preset === value}
              onClick={() => onPreset(value)}
              className={cn(
                "min-h-10 shrink-0 rounded-lg px-4 text-xs font-semibold transition-colors",
                selection.preset === value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-card",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {selection.preset === "custom" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold" htmlFor="finance-period-start">
              Mulai
              <Input id="finance-period-start" type="date" value={selection.startDate} onChange={(event) => onCustomStart(event.target.value)} className="h-10 rounded-xl" />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold" htmlFor="finance-period-end">
              Sampai
              <Input id="finance-period-end" type="date" value={selection.endDateExclusive.slice(0, 10)} onChange={(event) => onCustomEnd(event.target.value)} className="h-10 rounded-xl" />
            </label>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" />Business date · {timezone}</span>
          {serverPeriod ? (
            <span className="font-medium text-foreground">
              Server: {serverPeriod.startDate} → {serverPeriod.endDateExclusive} · {serverPeriod.timezone}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function FinanceHealthCard({
  status,
  critical,
  attention,
  principle,
}: {
  status: "HEALTHY" | "ATTENTION" | "UNHEALTHY";
  critical: Record<string, number>;
  attention: Record<string, number>;
  principle: string;
}) {
  const totals = {
    critical: Object.values(critical).reduce((sum, value) => sum + value, 0),
    attention: Object.values(attention).reduce((sum, value) => sum + value, 0),
  };
  const Icon = status === "HEALTHY" ? CheckCircle2 : status === "ATTENTION" ? AlertTriangle : CircleAlert;
  const tone = status === "HEALTHY" ? "success" : status === "ATTENTION" ? "warning" : "danger";
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <div className={cn(
            "grid size-11 shrink-0 place-items-center rounded-xl",
            tone === "success" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
            tone === "warning" && "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
            tone === "danger" && "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",
          )}>
            <Icon className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Finance health</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <FinanceStatus status={status} tone={tone} />
              <span className="text-xs text-muted-foreground">Server-generated, tenant-scoped</span>
            </div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border p-3">
            <p className="text-[11px] text-muted-foreground">Critical findings</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{totals.critical}</p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="text-[11px] text-muted-foreground">Attention findings</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{totals.attention}</p>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{principle}</p>
      </CardContent>
    </Card>
  );
}

export function FinanceAttributionCard({
  title,
  exactAmount,
  unallocatedAmount,
  coverageRatio,
  allocationPolicy,
}: {
  title: string;
  exactAmount: number;
  unallocatedAmount: number;
  coverageRatio: number | null;
  allocationPolicy: string;
}) {
  const coverageText = coverageRatio === null ? "Coverage belum tersedia" : Math.round(coverageRatio * 100) + "% covered";
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">Exact attribution only. No proportional split.</p>
          </div>
          <FinanceStatus status={coverageText} tone="info" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-emerald-50/40 p-3 dark:bg-emerald-950/10">
            <p className="text-[11px] text-muted-foreground">Exact attributable income</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatFinanceMoney(exactAmount)}</p>
          </div>
          <div className="rounded-xl border bg-amber-50/40 p-3 dark:bg-amber-950/10">
            <p className="text-[11px] text-muted-foreground">Belum teralokasi / ambigu</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatFinanceMoney(unallocatedAmount)}</p>
          </div>
        </div>
        <div className="rounded-xl bg-muted/40 p-3 text-xs leading-5">
          <span className="font-semibold">Allocation policy:</span> {allocationPolicy}
        </div>
      </CardContent>
    </Card>
  );
}

export function FinanceCorrectionDialog({
  open,
  onOpenChange,
  title,
  amount,
  onSubmit,
  busy,
  result,
  error,
  businessConflict = false,
  unknownOutcome = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  amount: string;
  onSubmit: (action: "void" | "reversal", reason: string) => void;
  busy: boolean;
  result: { correction_id: string; nomor_koreksi: string; replacement_transaksi_keuangan_id: string | null } | null;
  error?: string | null;
  businessConflict?: boolean;
  unknownOutcome?: boolean;
}) {
  const [action, setAction] = React.useState<"void" | "reversal">("void");
  const [reason, setReason] = React.useState("");
  if (!open) return null;

  const canSubmit = reason.trim().length >= 5 && !busy && !result;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="finance-correction-title">
      <div className="w-full max-w-lg rounded-3xl border bg-card p-5 shadow-2xl sm:p-6">
        <div className="flex items-start gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            <ShieldCheck className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="finance-correction-title" className="text-lg font-bold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Amount {amount}. Financial facts tidak diedit di tempat.</p>
          </div>
          <button type="button" className="rounded-lg px-2 py-1 text-xl text-muted-foreground hover:bg-muted" onClick={() => onOpenChange(false)} aria-label="Tutup">×</button>
        </div>

        {result ? (
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/15">
              <p className="font-semibold">Koreksi tersimpan</p>
              <p className="mt-1 text-sm text-muted-foreground">Histori asli dipertahankan.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs text-muted-foreground">Correction ID</p><p className="mt-1 break-all font-mono text-xs">{result.correction_id}</p></div>
              <div><p className="text-xs text-muted-foreground">Nomor Koreksi</p><p className="mt-1 font-semibold">{result.nomor_koreksi}</p></div>
            </div>
            {result.replacement_transaksi_keuangan_id ? <div><p className="text-xs text-muted-foreground">Replacement financial transaction</p><p className="mt-1 break-all font-mono text-xs">{result.replacement_transaksi_keuangan_id}</p></div> : null}
            <Button className="h-11 w-full rounded-xl" onClick={() => onOpenChange(false)}>Selesai</Button>
          </div>
        ) : (
          <>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {(["void", "reversal"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setAction(value)} className={cn("rounded-2xl border p-4 text-left", action === value ? "border-primary bg-primary/[0.035] ring-1 ring-primary/20" : "hover:bg-muted/40")}>
                  <p className="font-semibold">{value === "void" ? "Void" : "Reversal"}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{value === "void" ? "Tandai fakta sebagai void tanpa mengedit amount/source/date." : "Buat koreksi reversal yang dapat menghasilkan replacement transaction."}</p>
                </button>
              ))}
            </div>
            <label className="mt-4 grid gap-1.5 text-xs font-semibold" htmlFor="finance-correction-reason">Alasan koreksi <span className="font-normal text-muted-foreground">(min. 5 karakter)</span><textarea id="finance-correction-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={4} className="rounded-2xl border bg-background p-3 text-sm font-normal" placeholder="Contoh: pencatatan ganda pada payment ini." /></label>
            {businessConflict ? <Alert variant="destructive" className="mt-4"><CircleAlert /><AlertTitle>Business conflict</AlertTitle><AlertDescription>Koreksi tidak diizinkan pada state bisnis saat ini. Data finansial tidak diubah.</AlertDescription></Alert> : null}
            {unknownOutcome ? <Alert className="mt-4 border-amber-300 bg-amber-50/60"><AlertTriangle /><AlertTitle>Unknown outcome</AlertTitle><AlertDescription>Hasil command belum dapat dipastikan. Periksa reconciliation sebelum mengirim command lain.</AlertDescription></Alert> : null}
            {error && !businessConflict && !unknownOutcome ? <Alert variant="destructive" className="mt-4"><AlertTitle>Koreksi belum berhasil</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="h-11 flex-1 rounded-xl" onClick={() => onOpenChange(false)}>Batal</Button>
              <Button className="h-11 flex-1 rounded-xl" disabled={!canSubmit} onClick={() => onSubmit(action, reason.trim())}>{busy ? <Clock3 className="animate-spin" /> : "Koreksi Finansial"}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
