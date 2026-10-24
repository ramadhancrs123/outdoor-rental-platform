import { Activity, CircleAlert, CircleCheck, CircleDot, Clock3, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  formatInvestorCurrency,
  formatInvestorDateTime,
  type InvestorConnectionStatus,
} from "./types";

export function FreshnessBadge({
  status,
  lastChangedAt,
}: {
  status: InvestorConnectionStatus;
  lastChangedAt?: string | null;
}) {
  const config = {
    LIVE: { label: "LIVE", className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300", Icon: Wifi },
    CONNECTING: { label: "MENGHUBUNGKAN", className: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300", Icon: Clock3 },
    STALE: { label: "TERTINGGAL", className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300", Icon: WifiOff },
  }[status];

  return (
    <Badge variant="outline" className={cn("gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", config.className)}>
      <config.Icon className="size-3.5" aria-hidden="true" />
      {config.label}
      {lastChangedAt ? <span className="font-normal opacity-80">· {formatInvestorDateTime(lastChangedAt)}</span> : null}
    </Badge>
  );
}

export function MetricCard({
  label,
  value,
  helper,
  accent = "default",
}: {
  label: string;
  value: string;
  helper: string;
  accent?: "default" | "positive" | "negative" | "primary";
}) {
  const accentClass = {
    default: "bg-muted/55",
    positive: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300",
    negative: "bg-rose-50 text-rose-700 dark:bg-rose-950/25 dark:text-rose-300",
    primary: "bg-primary/10 text-primary",
  }[accent];

  return (
    <Card className="rounded-2xl border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-xl font-bold tracking-tight">{value}</p>
            <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{helper}</p>
          </div>
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", accentClass)}>
            <CircleDot className="size-4" aria-hidden="true" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function InvestorEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card className="rounded-2xl border-dashed shadow-none">
      <CardContent className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
        <CircleAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-semibold">{title}</p>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export function InvestorErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="rounded-2xl border-destructive/30 shadow-none">
      <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
        <CircleAlert className="size-8 text-destructive" aria-hidden="true" />
        <div>
          <p className="font-semibold">Data investor tidak dapat dimuat.</p>
          <p className="mt-1 text-sm text-muted-foreground">Sumber finansial tetap aman; coba ambil ulang data.</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Coba Lagi
        </button>
      </CardContent>
    </Card>
  );
}

export function InvestorActivityRow({
  direction,
  amount,
  impact,
  time,
  title,
  meta,
}: {
  direction: "income" | "expense";
  amount: number;
  impact: number;
  time: string;
  title: string;
  meta: string;
}) {
  const positive = direction === "income";
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/60 px-3 py-2.5">
      <span
        className={cn(
          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg",
          positive
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300"
            : "bg-rose-50 text-rose-700 dark:bg-rose-950/25 dark:text-rose-300",
        )}
      >
        {positive ? <CircleCheck className="size-4" aria-hidden="true" /> : <Activity className="size-4" aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">{title}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{meta}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={cn("text-xs font-bold", positive ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>
          {positive ? "+" : ""}{formatInvestorCurrency(amount)}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">Dampak: {formatInvestorCurrency(impact)}</p>
        <p className="mt-0.5 text-[9px] text-muted-foreground">{formatInvestorDateTime(time)}</p>
      </div>
    </div>
  );
}
