import { useEffect, useMemo, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Info,
  RefreshCw,
  WalletCards,
  X,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClientId } from "@/lib/client-id";
import { paths } from "@/routes/paths";
import {
  closeInvestorPeriod,
  getInvestorActivity,
  payoutInvestorBalance,
  transferInvestorEntitlement,
  getInvestorActivityExport,
  getInvestorOverview,
  getInvestorStakeholderHistory,
  transferInvestorAccountBalance,
  withdrawOperatorBalance,
} from "@/features/investor/service";
import { useInvestorDashboard } from "@/features/investor/use-investor-dashboard";
import { buildInvestorUiContract } from "@/features/investor/contract";
import { InvestorStakeholderHistoryCard } from "@/features/investor/stakeholder-history";
import {
  formatInvestorCurrency,
  formatInvestorDate,
  formatInvestorDateTime,
  type FinanceOperationalAccount,
  type InvestorConnectionStatus,
  type InvestorActivityItem,
  type InvestorOverview,
  type InvestorPeriodState,
  type InvestorPendingAllocation,
  type InvestorStakeholderAccount,
  type InvestorStakeholderHistory,
} from "@/features/investor/types";

type PrincipalIdentity = {
  name?: string;
  kind?: "admin" | "investor";
  usahaId?: string | null;
};

type PeriodRange = { start: string; endExclusive: string };
type InvestorTab = "summary" | "performance" | "transactions" | "accounts";

function compactCurrency(value: number | null | undefined) {
  if (value == null) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000_000) return `${sign}Rp${(abs / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (abs >= 1_000_000) return `${sign}Rp${(abs / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  if (abs >= 1_000) return `${sign}Rp${Math.round(abs / 1_000).toLocaleString("id-ID")} rb`;
  return `${sign}Rp${Math.round(abs).toLocaleString("id-ID")}`;
}

function shortNumber(value: number) {
  if (Math.abs(value) >= 1_000_000) return `${Math.round(value / 1_000_000)} jt`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)} rb`;
  return String(Math.round(value));
}

function safePercent(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function periodLabel(period: PeriodRange) {
  const [year, month, day] = period.start.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
}

function addCalendarDays(date: string, amount: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));
  return shifted.toISOString().slice(0, 10);
}

function addCalendarMonthsClamped(date: string, amount: number) {
  const [year, month, day] = date.split("-").map(Number);
  const targetMonth = new Date(Date.UTC(year, month - 1 + amount, 1));
  const targetYear = targetMonth.getUTCFullYear();
  const targetMonthIndex = targetMonth.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonthIndex, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

function configuredMonthAnchor(date: string, monthOffset: number, periodStartDay: number) {
  const [year, month] = date.split("-").map(Number);
  const targetMonth = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  const targetYear = targetMonth.getUTCFullYear();
  const targetMonthIndex = targetMonth.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonthIndex, Math.min(periodStartDay, lastDay)))
    .toISOString()
    .slice(0, 10);
}

function periodRangeLabel(period: PeriodRange) {
  const start = new Date(period.start + "T00:00:00");
  const end = new Date(period.endExclusive + "T00:00:00");
  end.setDate(end.getDate() - 1);
  const f = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
  return `${f.format(start)} – ${f.format(end)}`;
}

function buildTrend(items: InvestorActivityItem[]) {
  const daily = new Map<string, { income: number; expense: number; impact: number }>();
  for (const item of items) {
    const day = item.occurred_at.slice(0, 10);
    const current = daily.get(day) ?? { income: 0, expense: 0, impact: 0 };
    if (item.direction === "income") current.income += Math.abs(item.amount);
    else current.expense += Math.abs(item.amount);
    current.impact += item.investor_impact;
    daily.set(day, current);
  }

  let income = 0;
  let expense = 0;
  return [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => {
      income += value.income;
      expense += value.expense;
      return {
        day,
        label: new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(new Date(day + "T00:00:00")),
        income,
        expense,
        net: income - expense,
        impact: value.impact,
      };
    });
}

function SectionTitle({
  title,
  action,
  icon,
}: {
  title: string;
  action?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <span className="text-slate-500">{icon}</span> : null}
        <h2 className="truncate text-[14px] font-bold tracking-tight text-slate-900 sm:text-[15px]">{title}</h2>
      </div>
      {action ? (
        <button type="button" className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-blue-600">
          {action}<ChevronRight className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function LiveStatus({
  stale,
  reviewRequired,
  connectionStatus,
  timestamp,
}: {
  stale: boolean;
  reviewRequired: boolean;
  connectionStatus: InvestorConnectionStatus;
  timestamp?: string | null;
}) {
  const live = !reviewRequired && !stale && connectionStatus === "LIVE";
  const connecting = !reviewRequired && !stale && connectionStatus === "CONNECTING";
  const tone = reviewRequired
    ? "border-amber-200 bg-amber-50 text-amber-700"
    : stale
      ? "border-orange-200 bg-orange-50 text-orange-700"
      : connecting
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";
  const dotTone = reviewRequired
    ? "bg-amber-500"
    : stale
      ? "bg-orange-500"
      : connecting
        ? "bg-slate-400"
        : "bg-emerald-500";
  const label = reviewRequired ? "Perlu review" : stale ? "Tertinggal" : connecting ? "Menghubungkan" : "Live";
  const accessibleLabel = reviewRequired
    ? "Investor memerlukan review"
    : stale
      ? "Realtime Investor tertinggal"
      : live
        ? "Realtime Investor aktif"
        : "Realtime Investor menghubungkan";
  return (
    <span role="status" aria-label={accessibleLabel} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-semibold ${tone}`}>
      <span className={cn("size-1.5 rounded-full", dotTone)} />
      {label}
      {timestamp && !reviewRequired && live ? <span className="hidden font-normal opacity-75 sm:inline">· {formatInvestorDateTime(timestamp)}</span> : null}
    </span>
  );
}

function PeriodHeader({
  period,
  onPrevious,
  onNext,
  onToday,
  stale,
  reviewRequired,
  connectionStatus,
  timestamp,
  periodState,
  isCurrentPeriod,
  canNext,
}: {
  period: PeriodRange;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  stale: boolean;
  reviewRequired: boolean;
  connectionStatus: InvestorConnectionStatus;
  timestamp?: string | null;
  periodState: InvestorPeriodState;
  isCurrentPeriod: boolean;
  canNext: boolean;
}) {
  return (
    <header className="border-b border-slate-200/75 bg-[#f5f7f6] px-0 py-3 sm:py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <button type="button" className="hidden size-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm sm:grid" onClick={onPrevious} aria-label="Periode sebelumnya">
            <ArrowLeft className="size-3.5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold leading-5 text-slate-900">{periodLabel(period)}</p>
            <p className="truncate text-[10px] text-slate-500">
              {periodRangeLabel(period)} · {periodState === "CLOSED" ? "Ditutup · final" : isCurrentPeriod ? "Periode berjalan · belum ditutup" : "Belum ditutup"}
            </p>
          </div>
          <button type="button" disabled={!canNext} className="hidden size-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-40 sm:grid" onClick={onNext} aria-label="Periode berikutnya">
            <ArrowRight className="size-3.5" />
          </button>
          <button type="button" className="ml-1 grid size-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm" onClick={onToday} aria-label="Kembali ke periode aktif">
            <CalendarDays className="size-3.5" />
          </button>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <LiveStatus stale={stale} reviewRequired={reviewRequired} connectionStatus={connectionStatus} timestamp={timestamp} />
          <button type="button" className="grid size-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm" aria-label="Notifikasi">
            <Bell className="size-3.5" />
          </button>
          <span className="grid size-8 place-items-center rounded-full bg-slate-700 text-[10px] font-bold text-white">A</span>
        </div>
      </div>
    </header>
  );
}

function TabBar({ tab, onTab }: { tab: InvestorTab; onTab: (tab: InvestorTab) => void }) {
  const tabs: Array<{ key: InvestorTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: "summary", label: "Ringkasan", icon: CircleDollarSign },
    { key: "performance", label: "Performa", icon: BarChart3 },
    { key: "transactions", label: "Transaksi", icon: Activity },
    { key: "accounts", label: "Akun", icon: WalletCards },
  ];

  return (
    <nav className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-white/80 p-1 shadow-[0_2px_10px_rgba(30,68,57,.04)] ring-1 ring-slate-200/60" aria-label="Investor views">
      {tabs.map((item) => {
        const Icon = item.icon;
        const active = item.key === tab;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onTab(item.key)}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-semibold transition",
              active ? "bg-[#0d1f1b] text-white shadow-sm" : "text-slate-500 hover:bg-slate-50",
            )}
          >
            <Icon className="hidden size-3.5 sm:block" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function HeroInvestor({ overview }: { overview: InvestorOverview }) {
  const timezone = overview.period?.timezone;
  const pct = overview.percentage ?? 0;
  const net = overview.net_operational_result ?? null;
  const entitlement = overview.investor_entitlement ?? null;

  return (
    <section className="grid gap-2.5 sm:grid-cols-[1fr_1.35fr]">
      <Card className="overflow-hidden rounded-[20px] border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-white p-3 shadow-[0_6px_24px_rgba(21,185,120,.07)] sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold text-slate-500">Partisipasi Investor</p>
            <p className="mt-1 text-[28px] font-bold leading-none tracking-tight text-slate-950 sm:text-[40px]">{pct}%</p>
            <p className="mt-1.5 text-[9px] text-slate-500">Aktif sejak {overview.period ? formatInvestorDate(overview.period.start, timezone) : "—"}</p>
          </div>
          <svg viewBox="0 0 42 42" className="size-11 -rotate-90" aria-hidden="true">
            <circle cx="21" cy="21" r="16" fill="none" stroke="#dfe9e4" strokeWidth="5" />
            <circle cx="21" cy="21" r="16" fill="none" stroke="#14b86f" strokeWidth="5" strokeLinecap="round" pathLength="100" strokeDasharray={`${Math.max(0, Math.min(100, pct))} 100`} />
          </svg>
        </div>
      </Card>

      <Card className="rounded-[20px] border-emerald-100 bg-white p-3.5 shadow-[0_6px_24px_rgba(21,185,120,.05)] sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold text-slate-500">{overview.period_state === "CLOSED" ? "Alokasi Final Investor" : "Estimasi Hak Investor"}</p>
            <p className="mt-1 text-[25px] font-bold leading-none tracking-tight text-slate-950 sm:text-[36px]">{compactCurrency(entitlement)}</p>
            <p className="mt-2 text-[9px] text-slate-500">
              Dari hasil bersih operasional {compactCurrency(net)} × {pct}%
            </p>
            <div className={cn("mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-semibold", overview.period_state === "CLOSED" ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700")}>
              {overview.period_state === "CLOSED" ? "Periode ditutup · final" : "Perhitungan periode terbuka"}
            </div>
          </div>
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <BarChart3 className="size-5" />
          </div>
        </div>
      </Card>
    </section>
  );
}

function SmallKpi({
  title,
  value,
  delta,
  tone,
}: {
  title: string;
  value: string;
  delta?: string | null;
  tone: "income" | "expense" | "net";
}) {
  const color = tone === "expense" ? "text-orange-600" : "text-emerald-600";
  return (
    <Card className="min-w-0 rounded-[16px] border-slate-200/75 bg-white px-2.5 py-2.5 shadow-[0_3px_14px_rgba(30,68,57,.035)]">
      <p className="truncate text-[9px] font-medium text-slate-500">{title}</p>
      <p className="mt-1 truncate text-[15px] font-bold tracking-tight text-slate-950 sm:text-[18px]">{value}</p>
      {delta ? <p className={`mt-0.5 text-[8px] font-semibold ${color}`}>{delta}</p> : <p className="mt-0.5 text-[8px] text-slate-400">periode berjalan</p>}
    </Card>
  );
}

function PerformanceChart({ items, compact = false }: { items: InvestorActivityItem[]; compact?: boolean }) {
  const trend = useMemo(() => buildTrend(items), [items]);
  const width = 720;
  const height = compact ? 180 : 230;
  const left = 38;
  const right = 10;
  const top = 8;
  const bottom = 27;
  const chartHeight = height - top - bottom;
  const maxValue = Math.max(15_000_000, ...trend.flatMap((v) => [v.income, v.expense, v.net]));
  const scale = Math.ceil(maxValue / 5_000_000) * 5_000_000;
  const x = (i: number) => left + (trend.length <= 1 ? (width - left - right) / 2 : (i / (trend.length - 1)) * (width - left - right));
  const y = (value: number) => top + chartHeight - (Math.max(0, value) / scale) * chartHeight;
  const points = (key: "income" | "expense" | "net") => trend.map((p, i) => `${x(i)},${y(p[key])}`).join(" ");
  const yTicks = [scale, scale * 2 / 3, scale / 3, 0];

  return (
    <Card className={cn("rounded-[20px] border-slate-200/75 bg-white shadow-[0_5px_20px_rgba(30,68,57,.04)]", compact ? "p-3" : "p-3.5 sm:p-4")}>
      <div className="flex items-center justify-between gap-2">
        <SectionTitle title="Performa Operasional" action={compact ? undefined : "Detail"} />
        <div className="hidden rounded-lg bg-slate-50 p-0.5 text-[9px] sm:flex">
          <span className="rounded-md bg-white px-2.5 py-1.5 font-semibold text-slate-700 shadow-sm">Harian</span>
          <span className="px-2.5 py-1.5 text-slate-400">Mingguan</span>
          <span className="px-2.5 py-1.5 text-slate-400">Bulanan</span>
        </div>
      </div>
      <div className={cn("mt-2 w-full", compact ? "h-[160px]" : "h-[220px] sm:h-[270px]")}>
        {trend.length ? (
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Performa operasional">
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke="#e7ece9" strokeDasharray="3 4" />
                <text x="2" y={y(v) + 3} fontSize="8" fill="#8a9791">{shortNumber(v)}</text>
              </g>
            ))}
            {trend.map((p, i) => (
              <text key={p.day} x={x(i)} y={height - 8} textAnchor="middle" fontSize="8" fill="#8a9791">
                {trend.length <= 7 || i % Math.max(1, Math.ceil(trend.length / 5)) === 0 ? p.label : ""}
              </text>
            ))}
            <polyline points={points("income")} fill="none" stroke="#15b878" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={points("expense")} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={points("net")} fill="none" stroke="#3b82f6" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
            {trend.map((p, i) => (
              <g key={`pt-${p.day}`}>
                <circle cx={x(i)} cy={y(p.income)} r="2" fill="#15b878" />
                <circle cx={x(i)} cy={y(p.expense)} r="1.7" fill="#f59e0b" />
                <circle cx={x(i)} cy={y(p.net)} r="1.8" fill="#3b82f6" />
              </g>
            ))}
          </svg>
        ) : (
          <div className="grid h-full place-items-center rounded-xl bg-slate-50 text-[10px] text-slate-400">Belum ada transaksi tercatat pada periode ini.</div>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-slate-500">
        <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-emerald-500" />Pemasukan</span>
        <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-amber-500" />Pengeluaran</span>
        <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-blue-500" />Hasil Bersih</span>
      </div>
    </Card>
  );
}

function InvestorImpactChart({ items }: { items: InvestorActivityItem[] }) {
  const data = useMemo(() => {
    const byDay = new Map<string, { positive: number; negative: number }>();
    for (const item of items) {
      const day = item.occurred_at.slice(0, 10);
      const row = byDay.get(day) ?? { positive: 0, negative: 0 };
      if (item.investor_impact >= 0) row.positive += item.investor_impact;
      else row.negative += Math.abs(item.investor_impact);
      byDay.set(day, row);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([day, values]) => ({
        day,
        label: new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(new Date(day + "T00:00:00")),
        ...values,
      }));
  }, [items]);

  const max = Math.max(1, ...data.flatMap((p) => [p.positive, p.negative]));

  return (
    <Card className="rounded-[20px] border-slate-200/75 bg-white p-2.5 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
      <SectionTitle title="Kinerja Hak Investor" />
      <p className="mt-1 text-[9px] text-slate-500">Dampak investor dari pemasukan dan pengeluaran yang sudah tercatat.</p>

      <div className="mt-4 flex h-[185px] items-end gap-2.5">
        {data.length ? data.map((point) => {
          const positiveHeight = Math.max(8, Math.round((point.positive / max) * 118));
          const negativeHeight = Math.max(8, Math.round((point.negative / max) * 118));
          return (
            <div key={point.day} className="flex min-w-0 flex-1 flex-col items-center justify-end">
              <div className="flex h-[145px] items-end gap-1">
                <div className="w-3 rounded-t-md bg-blue-400" style={{ height: positiveHeight }} title={`Dampak positif ${shortNumber(point.positive)}`} />
                <div className="w-3 rounded-t-md bg-orange-400" style={{ height: negativeHeight }} title={`Dampak negatif ${shortNumber(point.negative)}`} />
              </div>
              <span className="mt-2 text-[8px] text-slate-400">{point.label}</span>
            </div>
          );
        }) : (
          <div className="grid w-full place-items-center text-[10px] text-slate-400">Belum ada dampak investor tercatat.</div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-slate-500">
        <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-blue-400" />Dampak positif</span>
        <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-orange-400" />Dampak negatif</span>
      </div>
    </Card>
  );
}

function ExpenseRatio({ overview }: { overview: InvestorOverview }) {
  const income = overview.income_recorded ?? 0;
  const expense = overview.expense_recorded ?? 0;
  const ratio = income > 0 ? Math.min(100, (expense / income) * 100) : 0;
  return (
    <Card className="rounded-[20px] border-slate-200/75 bg-white p-2.5 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
      <SectionTitle title="Rasio Pengeluaran" />
      <div className="mt-4 flex items-center justify-center">
        <div className="relative grid size-28 place-items-center rounded-full p-2" style={{ background: `conic-gradient(#f59e0b 0 ${ratio}%, #3b82f6 ${ratio}% 100%)` }}>
          <div className="grid size-full place-items-center rounded-full bg-white">
            <span className="text-[15px] font-bold text-slate-800">{ratio.toFixed(1).replace(".", ",")}%</span>
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-2 text-[9px] text-slate-500">
        <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-amber-500" />Pengeluaran</span><strong className="text-slate-700">{ratio.toFixed(1).replace(".", ",")}%</strong></div>
        <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-blue-500" />Hasil Bersih</span><strong className="text-slate-700">{Math.max(0, 100 - ratio).toFixed(1).replace(".", ",")}%</strong></div>
      </div>
    </Card>
  );
}

function WhyChanges({ current, previous, activities }: { current: InvestorOverview; previous?: InvestorOverview | null; activities: InvestorActivityItem[] }) {
  const delta = current.net_operational_result != null && previous?.net_operational_result != null
    ? current.net_operational_result - previous.net_operational_result
    : null;
  const drivers = [...activities].sort((a, b) => Math.abs(b.investor_impact) - Math.abs(a.investor_impact)).slice(0, 3);
  return (
    <Card className="rounded-[20px] border-slate-200/75 bg-white p-2.5 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
      <SectionTitle title="Mengapa Berubah?" icon={<Info className="size-3.5" />} />
      <div className="mt-1.5 flex items-center gap-2 border-b border-slate-100 pb-1.5">
        <span className={cn("grid size-9 place-items-center rounded-full", delta == null || delta >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-600")}>
          {delta == null || delta >= 0 ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
        </span>
        <div>
          <p className="text-[14px] font-bold text-slate-900">{delta == null ? "—" : compactCurrency(delta)}</p>
          <p className="text-[9px] text-slate-500">dibanding periode sebelumnya</p>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {drivers.length ? drivers.map((item) => (
          <div key={item.transaksi_keuangan_id} className="flex items-center gap-2 py-1.5">
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-lg", item.investor_impact >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-600")}>
              {item.investor_impact >= 0 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-semibold text-slate-700">{item.activity_reason}</p>
              <p className="truncate text-[8px] text-slate-400">{item.nomor_transaksi}</p>
            </div>
            <span className={cn("shrink-0 text-[10px] font-bold", item.investor_impact >= 0 ? "text-emerald-600" : "text-orange-600")}>
              {item.investor_impact >= 0 ? "+" : "−"}{compactCurrency(Math.abs(item.investor_impact))}
            </span>
          </div>
        )) : <div className="py-4 text-[10px] text-slate-400">Belum ada aktivitas penjelas.</div>}
      </div>
    </Card>
  );
}

function RecentActivity({
  items,
  onSelect,
}: {
  items: InvestorActivityItem[];
  onSelect: (item: InvestorActivityItem) => void;
}) {
  return (
    <Card className="rounded-[20px] border-slate-200/75 bg-white p-2.5 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
      <SectionTitle title="Aktivitas Terbaru" action="Lihat semua" />
      <div className="mt-2 divide-y divide-slate-100">
        {items.slice(0, 3).map((item) => {
          const positive = item.direction === "income";
          return (
            <button key={item.transaksi_keuangan_id} type="button" onClick={() => onSelect(item)} className="flex w-full items-center gap-2 py-1.5 text-left">
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", positive ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-600")}>
                {positive ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[9px] text-slate-400">{formatInvestorDateTime(item.occurred_at)}</span>
                <span className="block truncate text-[10px] font-semibold text-slate-800">{item.activity_reason}</span>
                <span className="block truncate text-[9px] text-slate-400">{item.nomor_transaksi}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className={cn("block text-[11px] font-bold", positive ? "text-emerald-600" : "text-orange-600")}>{positive ? "+" : "−"}{compactCurrency(Math.abs(item.amount))}</span>
                <span className="block text-[9px] text-slate-400">Dampak: {item.investor_impact >= 0 ? "+" : "−"}{compactCurrency(Math.abs(item.investor_impact))}</span>
              </span>
            </button>
          );
        })}
        {!items.length ? <div className="py-8 text-center text-[10px] text-slate-400">Belum ada aktivitas pada periode ini.</div> : null}
      </div>
    </Card>
  );
}

function TransactionDetail({
  item,
  onClose,
}: {
  item: InvestorActivityItem | null;
  onClose: () => void;
}) {
  if (!item) return null;
  const positive = item.direction === "income";
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/25 sm:items-center sm:justify-center">
      <button className="absolute inset-0" aria-label="Tutup detail transaksi" onClick={onClose} />
      <Card className="relative w-full max-w-lg rounded-t-[24px] border-slate-200 bg-white p-4 shadow-2xl sm:rounded-[24px]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", positive ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-600")}>
              {positive ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-bold text-slate-800">{item.activity_reason}</p>
              <p className="text-[9px] text-slate-400">{item.nomor_transaksi}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full bg-slate-50 text-slate-500" aria-label="Tutup">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-[10px]">
          <div className="flex justify-between gap-4"><span className="text-slate-500">Tanggal</span><strong>{formatInvestorDateTime(item.occurred_at)}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">Sumber</span><strong>{item.source_type ?? "—"}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">Jumlah</span><strong className={positive ? "text-emerald-600" : "text-orange-600"}>{positive ? "+" : "−"}{formatInvestorCurrency(Math.abs(item.amount))}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">Dampak Investor</span><strong className={item.investor_impact >= 0 ? "text-emerald-600" : "text-orange-600"}>{item.investor_impact >= 0 ? "+" : "−"}{formatInvestorCurrency(Math.abs(item.investor_impact))}</strong></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">Mata uang</span><strong>{item.currency_code}</strong></div>
          <div className="pt-2">
            <Link
              to={paths.keuangan + "/transaksi/" + item.transaksi_keuangan_id}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-[9px] font-semibold text-white"
            >
              Lihat sumber transaksi <ArrowRight className="size-3" />
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}

function CalculationSummary({ overview }: { overview: InvestorOverview }) {
  return (
    <Card className="rounded-[20px] border-slate-200/75 bg-white p-2.5 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
      <SectionTitle title="Bagaimana Dihitung?" />
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] gap-1.5 text-[9px]">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-2.5 py-2.5"><span className="block text-slate-400">Pemasukan</span><strong className="mt-1 block text-slate-800">{compactCurrency(overview.income_recorded)}</strong></div>
        <span className="grid place-items-center text-sm font-bold text-slate-300">−</span>
        <div className="rounded-xl border border-orange-100 bg-orange-50/70 px-2.5 py-2.5"><span className="block text-slate-400">Pengeluaran</span><strong className="mt-1 block text-slate-800">{compactCurrency(overview.expense_recorded)}</strong></div>
      </div>
      <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] gap-1.5 text-[9px]">
        <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-2.5 py-2.5"><span className="block text-slate-400">Hasil Bersih</span><strong className="mt-1 block text-slate-800">{compactCurrency(overview.net_operational_result)}</strong></div>
        <span className="grid place-items-center text-sm font-bold text-slate-300">×</span>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5"><span className="block text-slate-400">Partisipasi</span><strong className="mt-1 block text-slate-800">{overview.percentage ?? "—"}%</strong></div>
      </div>
      <div className="mt-1.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-[10px]">
        <span className="block text-emerald-700/80">{overview.period_state === "CLOSED" ? "Alokasi Final Investor" : "Estimasi Hak Investor Berjalan"}</span>
        <strong className="mt-1 block text-[15px] text-emerald-700">{compactCurrency(overview.investor_entitlement)}</strong>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[8px] text-slate-400">
        <span>{overview.period ? `Periode ${formatInvestorDate(overview.period.start)} → ${formatInvestorDate(overview.period.end_exclusive)}` : "Periode —"}</span>
        <span>Basis Net Operasional</span>
      </div>
    </Card>
  );
}

function businessDate(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function AccountsTab({
  dashboard,
  selectedOverview,
  selectedContract,
  stakeholderHistory,
  canClosePeriod,
  canRecordOpenAdvance,
  closePending,
  closeError,
  onClosePeriod,
  onFinanceChange,
}: {
  dashboard: ReturnType<typeof useInvestorDashboard>;
  selectedOverview: InvestorOverview;
  selectedContract: ReturnType<typeof buildInvestorUiContract>;
  stakeholderHistory?: InvestorStakeholderHistory;
  canClosePeriod: boolean;
  canRecordOpenAdvance: boolean;
  closePending: boolean;
  closeError: string | null;
  onClosePeriod: () => void;
  onFinanceChange: () => Promise<void>;
}) {
  const overview = selectedOverview;
  const accounts = dashboard.operationalAccounts.data?.accounts ?? [];
  const capability = selectedContract?.capabilities.closePeriod;
  const canClose = canClosePeriod;
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const closingCash = Number(overview?.operational_cash ?? 0);
  const reserveAmount = Number(overview?.reserve_amount ?? 0);
  const distributable = Number(overview?.estimated_distributable_cash ?? 0);
  const investorShare = Number(overview?.investor_entitlement ?? 0);
  const operatorShare = Number(overview?.operator_remainder ?? 0);
  const canPayClosedAllocations = selectedContract?.capabilities.distributeInvestorAllocation === "SERVER_GUARDED";
  const canWithdrawOperatorAllocation = selectedContract?.capabilities.withdrawOperatorAllocation === "SERVER_GUARDED";
  const canTransferClosedEntitlement = selectedContract?.capabilities.transferInvestorEntitlement === "SERVER_GUARDED";
  const canManageClosedAllocations = canPayClosedAllocations || canWithdrawOperatorAllocation || canTransferClosedEntitlement;
  const investorAllocationsForPeriod = (dashboard.stakeholderAccounts.data?.investor_allocations ?? [])
    .filter((allocation) =>
      allocation.period_start === overview.period?.start &&
      allocation.period_end_exclusive === overview.period?.end_exclusive &&
      allocation.remaining_amount > 0
    );
  const operatorAllocationsForPeriod = (dashboard.stakeholderAccounts.data?.operator_allocations ?? [])
    .filter((allocation) =>
      allocation.period_start === overview.period?.start &&
      allocation.period_end_exclusive === overview.period?.end_exclusive &&
      allocation.remaining_amount > 0
    );
  const advanceRowsForSelectedPeriod = (stakeholderHistory?.payouts ?? []).filter((payout) =>
    payout.status === "recorded" &&
    payout.payout_kind === "allocation_payout" &&
    payout.period_start === overview.period?.start &&
    payout.period_id === null &&
    payout.investor_allocation_id === null &&
    payout.operator_allocation_id === null
  );
  const investorAdvancePaid = advanceRowsForSelectedPeriod
    .filter((payout) => payout.stakeholder_type === "investor")
    .reduce((total, payout) => total + Number(payout.amount || 0), 0);
  const operatorAdvancePaid = advanceRowsForSelectedPeriod
    .filter((payout) => payout.stakeholder_type === "pengelola")
    .reduce((total, payout) => total + Number(payout.amount || 0), 0);
  const remainingInvestorAdvance = Math.max(0, Number(overview.investor_entitlement ?? 0) - investorAdvancePaid);
  const remainingOperatorAdvance = Math.max(0, Number(overview.operator_remainder ?? 0) - operatorAdvancePaid);
  return (
    <div className="space-y-3">
      <section className="grid gap-3 lg:grid-cols-[1.1fr_.9fr]">
        <Card className="rounded-[20px] border-slate-200/75 bg-white p-2.5 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
          <SectionTitle title="Saldo Akun" action="Lihat semua" />
          <div className="mt-3 space-y-2">
            {accounts.length ? accounts.map((account) => (
              <div key={account.akun_keuangan_id} className="flex items-center gap-3 rounded-2xl border border-slate-100 px-3 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><WalletCards className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-bold text-slate-800">Akun Usaha (Operasional)</p>
                  <p className="text-[9px] text-slate-500">{account.nama_akun} · {account.mata_uang}</p>
                </div>
                <strong className="shrink-0 text-[12px] font-bold text-slate-900">{formatInvestorCurrency(account.saldo, account.mata_uang)}</strong>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-[10px] text-slate-500">Saldo akun operasional belum tersedia.</div>
            )}
          </div>
        </Card>

        <Card className="rounded-[20px] border-slate-200/75 bg-white p-2.5 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
          <SectionTitle title="Rincian Keuangan Investor" />
          <div className="mt-3 space-y-2 text-[10px]">
            <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5"><span className="text-slate-600">{overview.period_state === "CLOSED" ? "Alokasi final periode" : "Estimasi periode ini"}</span><strong className="text-emerald-700">{compactCurrency(overview.investor_entitlement)}</strong></div>
            <div className="flex items-center justify-between rounded-xl bg-blue-50 px-3 py-2.5"><span className="text-slate-600">Kas distributable</span><strong className="text-blue-700">{compactCurrency(overview?.estimated_distributable_cash)}</strong></div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5"><span className="text-slate-600">Cadangan operasional</span><strong className="text-slate-800">{compactCurrency(overview?.reserve_amount)}</strong></div>
          </div>
          {canClose ? (
            confirmCloseOpen ? (
              <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <p className="text-[11px] font-bold text-slate-800">Ringkasan pembagian hasil</p>
                <div className="space-y-1.5 text-[10px]">
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-2.5 py-2"><span className="text-slate-500">Hasil periode</span><strong className="text-slate-800">{compactCurrency(Number(overview.net_operational_result ?? 0))}</strong></div>
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-2.5 py-2"><span className="text-slate-500">Cadangan operasional (tetap di Akun Usaha)</span><strong className="text-slate-800">{compactCurrency(reserveAmount)}</strong></div>
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-blue-50 px-2.5 py-2"><span className="text-slate-600">Dana yang dibagi</span><strong className="text-blue-700">{compactCurrency(distributable)}</strong></div>
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-2.5 py-2"><span className="text-slate-600">Bagian Investor ({overview.percentage ?? 0}%)</span><strong className="text-emerald-700">{compactCurrency(investorShare)}</strong></div>
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-violet-50 px-2.5 py-2"><span className="text-slate-600">Bagian Pengelola</span><strong className="text-violet-700">{compactCurrency(operatorShare)}</strong></div>
                </div>
                <p className="text-[9px] leading-4 text-slate-500">
                  Angka di atas adalah estimasi saat ini. Saat periode ditutup, perhitungan final dilakukan server dan periode terkunci; koreksi berikutnya hanya lewat jalur koreksi yang tercatat. Saldo kas operasional setelah penutupan diperkirakan {compactCurrency(closingCash)}.
                </p>
                {closeError ? <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-2.5 py-2 text-[9px] text-red-700">{closeError}</p> : null}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="h-9 flex-1 rounded-xl text-[10px]" disabled={closePending} onClick={() => setConfirmCloseOpen(false)}>Batal</Button>
                  <Button type="button" className="h-9 flex-1 rounded-xl bg-[#10231f] text-[10px] font-semibold text-white hover:bg-[#10231f]/90" disabled={closePending} onClick={onClosePeriod}>
                    {closePending ? "Menutup periode…" : "Konfirmasi & Bagi Hasil"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" onClick={() => setConfirmCloseOpen(true)} className="mt-3 h-10 w-full rounded-xl bg-[#10231f] text-[11px] font-semibold text-white hover:bg-[#10231f]/90">
                Tutup Periode & Bagi Hasil <ArrowRight className="ml-1 size-3.5" />
              </Button>
            )
          ) : capability === "SERVER_GUARDED" ? (
            <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[9px] text-blue-700">
              Periode masih berjalan. Penutupan tersedia setelah tanggal akhir periode.
            </p>
          ) : null}
          {overview.period_state === "CLOSED" ? (
            <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[9px] text-emerald-700">Periode sudah ditutup. Alokasi final menjadi dasar distribusi.</div>
          ) : null}
        </Card>
      </section>

      {dashboard.stakeholderAccounts.data ? (
        <>
          <Card className="rounded-[20px] border-slate-200/75 bg-white p-2.5 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
            <SectionTitle title="Saldo Akun Hasil (Mutasi Tercatat)" />
            <p className="mt-1 text-[9px] text-slate-500">Ini saldo uang aktual pada akun holding hasil, bukan alokasi yang belum dicairkan. Alokasi tersisa ditampilkan terpisah di Distribusi dan Penarikan.</p>
            <div className="mt-3 space-y-2">
              {dashboard.stakeholderAccounts.data.accounts.map((account) => (
                <div key={account.akun_keuangan_id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-bold text-slate-800">{account.nama_akun}</p>
                    <p className="text-[9px] text-slate-500">{account.fungsi_akun === "investor" ? "Saldo Investor" : "Saldo Pengelola"} · {account.mata_uang}</p>
                  </div>
                  <strong className="shrink-0 text-[11px] font-bold text-slate-900">{formatInvestorCurrency(account.saldo, account.mata_uang)}</strong>
                </div>
              ))}
              {!dashboard.stakeholderAccounts.data.accounts.length ? (
                <p className="rounded-xl border border-dashed border-slate-200 p-3 text-[9px] text-slate-500">
                  Akun saldo hasil belum disiapkan. Buat akun uang baru lalu tetapkan fungsinya di Konfigurasi Investor.
                </p>
              ) : null}
            </div>
          </Card>

          {overview.principal === "admin" ? (
            <Card className="rounded-[20px] border-slate-200/75 bg-white p-2.5 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
              <SectionTitle title="Pembayaran dan Alih Hak" />
              <p className="mt-1 text-[9px] leading-4 text-slate-500">
                Pembayaran keluar, alih hak Investor, dan perpindahan uang antar akun dicatat terpisah. Transfer internal bukan pembayaran, dan pembayaran tidak mengubah hasil operasional.
              </p>

              {canRecordOpenAdvance && overview.period?.start ? (
                <div className="mt-3 space-y-2.5 rounded-xl border border-amber-100 bg-amber-50/20 p-2.5">
                  <div>
                    <p className="text-[10px] font-bold text-slate-800">Penarikan sebelum closing</p>
                    <p className="mt-0.5 text-[9px] leading-4 text-slate-500">
                      Penarikan awal dibukukan sebagai advance, dibayar dari kas usaha, dan diperhitungkan terhadap hak final setelah periode ditutup.
                    </p>
                  </div>
                  {remainingInvestorAdvance > 0 ? (
                    <OpenPeriodAdvanceCard
                      kind="investor"
                      usahaId={dashboard.principal.data?.usahaId ?? ""}
                      periodStart={overview.period.start}
                      availableEntitlement={remainingInvestorAdvance}
                      operationalAccounts={accounts}
                      onSuccess={onFinanceChange}
                    />
                  ) : null}
                  {remainingOperatorAdvance > 0 ? (
                    <OpenPeriodAdvanceCard
                      kind="pengelola"
                      usahaId={dashboard.principal.data?.usahaId ?? ""}
                      periodStart={overview.period.start}
                      availableEntitlement={remainingOperatorAdvance}
                      operationalAccounts={accounts}
                      onSuccess={onFinanceChange}
                    />
                  ) : null}
                  {remainingInvestorAdvance <= 0 && remainingOperatorAdvance <= 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2.5 text-[9px] text-slate-500">
                      Tidak ada estimasi hak tersisa untuk penarikan awal. Pembayaran sebelumnya sudah menghabiskan estimasi hak atau nilainya belum positif.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {canManageClosedAllocations ? (
                <div className="mt-3 space-y-2.5">
                  {investorAllocationsForPeriod.map((allocation) => (
                    <div key={"investor-actions-" + allocation.allocation_id} className="space-y-2.5">
                      {canPayClosedAllocations ? (
                        <SettlementAllocationCard
                          kind="investor"
                          allocation={allocation}
                          operationalAccounts={accounts}
                          usahaId={dashboard.principal.data?.usahaId ?? ""}
                          onSuccess={onFinanceChange}
                        />
                      ) : null}
                      {canTransferClosedEntitlement ? (
                        <InvestorEntitlementTransferCard
                          allocation={allocation}
                          operationalAccounts={accounts}
                          stakeholderAccounts={dashboard.stakeholderAccounts.data!.accounts}
                          operatorAllocations={operatorAllocationsForPeriod}
                          usahaId={dashboard.principal.data?.usahaId ?? ""}
                          onSuccess={onFinanceChange}
                        />
                      ) : null}
                    </div>
                  ))}
                  {canWithdrawOperatorAllocation ? operatorAllocationsForPeriod.map((allocation) => (
                    <SettlementAllocationCard
                      key={"operator-" + allocation.allocation_id}
                      kind="pengelola"
                      allocation={allocation}
                      operationalAccounts={accounts}
                      usahaId={dashboard.principal.data?.usahaId ?? ""}
                      onSuccess={onFinanceChange}
                    />
                  )) : null}
                  {!investorAllocationsForPeriod.length && !operatorAllocationsForPeriod.length ? (
                    <p className="rounded-xl border border-dashed border-slate-200 p-3 text-[9px] text-slate-500">
                      Tidak ada alokasi tersisa untuk periode yang sedang dipilih.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!canRecordOpenAdvance && !canManageClosedAllocations ? (
                <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-[9px] leading-4 text-amber-800">
                  Aksi finansial sementara dinonaktifkan karena periode ini belum memenuhi syarat aksi, data stale, atau perhitungan perlu ditinjau. Muat ulang hasil periode sebelum melanjutkan.
                </p>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}

      <Card className="rounded-[20px] border-slate-200/75 bg-white p-2.5 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
        <SectionTitle title="Riwayat Partisipasi" />
        <div className="mt-3 space-y-2">
          {(dashboard.participation.data?.items ?? []).slice(0, 4).map((item) => (
            <div key={item.participation_id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5 text-[9px]">
              <div>
                <strong className="block text-slate-800">{item.percentage}% · {item.basis_type === "net_operational_result" ? "Hasil Bersih Operasional" : item.basis_type}</strong>
                <span className="text-slate-400">{formatInvestorDate(item.effective_from)}{item.effective_until ? " → " + formatInvestorDate(item.effective_until) : " → sekarang"}</span>
              </div>
              <span className={cn("rounded-full px-2 py-1 font-semibold", item.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{item.status === "active" ? "Aktif" : "Berakhir"}</span>
            </div>
          ))}
          {!dashboard.participation.data?.items?.length ? <p className="text-[9px] text-slate-400">Riwayat partisipasi belum tersedia.</p> : null}
        </div>
      </Card>

      <Card className="rounded-[20px] border-slate-200/75 bg-white p-2.5 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
        <SectionTitle title="Kualitas Data" />
        <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-2.5"><span className="block text-slate-400">Akun operasional</span><strong>{dashboard.reconciliation.data?.operational_account_count ?? accounts.length}</strong></div>
          <div className="rounded-xl bg-slate-50 p-2.5"><span className="block text-slate-400">Event pending</span><strong>{dashboard.reconciliation.data?.pending_realtime_events ?? "—"}</strong></div>
          <div className="rounded-xl bg-slate-50 p-2.5"><span className="block text-slate-400">Allocation belum selesai</span><strong>{dashboard.reconciliation.data?.unsettled_allocations ?? "—"}</strong></div>
          <div className="rounded-xl bg-slate-50 p-2.5"><span className="block text-slate-400">Status rekonsiliasi</span><strong className={dashboard.reconciliation.data?.status === "HEALTHY" ? "text-emerald-600" : "text-orange-600"}>{dashboard.reconciliation.data?.status ?? "—"}</strong></div>
        </div>
      </Card>
    </div>
  );
}


export function OpenPeriodAdvanceCard({
  kind,
  usahaId,
  periodStart,
  availableEntitlement,
  operationalAccounts,
  onSuccess,
}: {
  kind: "investor" | "pengelola";
  usahaId: string;
  periodStart: string;
  availableEntitlement: number;
  operationalAccounts: FinanceOperationalAccount[];
  onSuccess: () => Promise<void>;
}) {
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [destinationName, setDestinationName] = useState("");
  const [destinationReference, setDestinationReference] = useState("");
  const [note, setNote] = useState("");
  const [attemptId, setAttemptId] = useState(() => createClientId());
  const currencies = useMemo(
    () => [...new Set(operationalAccounts.map((account) => account.mata_uang))],
    [operationalAccounts],
  );
  const validCurrencyPool = currencies.length === 1;
  const currencyCode = currencies[0] ?? "IDR";
  const sources = useMemo(
    () => validCurrencyPool
      ? operationalAccounts.filter((account) => account.mata_uang === currencyCode)
      : [],
    [operationalAccounts, validCurrencyPool, currencyCode],
  );
  const soleSourceId = sources.length === 1 ? sources[0].akun_keuangan_id : "";
  const source = sources.find((account) => account.akun_keuangan_id === sourceAccountId);
  const amountValue = Number(amount);
  const maxFromSource = Math.min(availableEntitlement, source?.saldo ?? 0);

  useEffect(() => {
    if (soleSourceId) setSourceAccountId(soleSourceId);
    else if (!sources.some((account) => account.akun_keuangan_id === sourceAccountId)) setSourceAccountId("");
  }, [soleSourceId, sources, sourceAccountId]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!usahaId) throw new Error("Usaha aktif belum tersedia.");
      if (!source) throw new Error("Pilih akun operasional sumber.");
      if (!destinationName.trim()) throw new Error("Nama penerima wajib diisi.");
      if (!Number.isFinite(amountValue) || amountValue <= 0 || amountValue > availableEntitlement || amountValue > source.saldo) {
        throw new Error("Nominal harus lebih dari nol serta tidak melebihi estimasi hak dan saldo akun sumber.");
      }
      const idempotencyKey = ["investor-open-advance", kind, periodStart, attemptId].join("-");
      const input = {
        usahaId,
        periodStart,
        allocationId: null,
        sourceAccountId: source.akun_keuangan_id,
        amount: amountValue,
        paidAt: new Date().toISOString(),
        destinationName: destinationName.trim(),
        destinationReference: destinationReference.trim() || null,
        catatan: note.trim() || null,
        idempotencyKey,
        requestId: attemptId,
      };
      return kind === "investor"
        ? payoutInvestorBalance(input)
        : withdrawOperatorBalance(input);
    },
    onSuccess: async () => {
      setAmount("");
      setDestinationName("");
      setDestinationReference("");
      setNote("");
      setAttemptId(createClientId());
      await onSuccess();
    },
  });

  return (
    <div className="rounded-2xl border border-amber-200/80 bg-amber-50/35 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-slate-800">Penarikan awal · {kind === "investor" ? "Investor" : "Pengelola"}</p>
          <p className="mt-0.5 text-[9px] text-slate-500">Periode {formatInvestorDate(periodStart)} · belum ditutup</p>
        </div>
        <strong className="shrink-0 text-[11px] font-bold text-slate-900">{formatInvestorCurrency(availableEntitlement, currencyCode)}</strong>
      </div>
      <p className="mt-2 text-[9px] leading-4 text-slate-600">
        Catat hanya setelah uang benar-benar dibayarkan kepada penerima. Ini dicatat sebagai penarikan awal dari estimasi hak periode berjalan, bukan pengeluaran operasional dan bukan alokasi final. Closing tetap menghitung hasil periode sesuai transaksi yang tercatat.
      </p>

      {!validCurrencyPool ? (
        <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-100/70 px-2.5 py-2 text-[9px] text-amber-900">
          Penarikan awal dinonaktifkan karena akun operasional memiliki lebih dari satu mata uang atau belum tersedia. Periksa akun dan rekonsiliasi terlebih dahulu.
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor={`advance-source-${kind}-${periodStart}`} className="text-[9px] text-slate-500">Akun usaha sumber</Label>
              <select
                id={`advance-source-${kind}-${periodStart}`}
                value={sourceAccountId}
                onChange={(event) => {
                  setSourceAccountId(event.target.value);
                  setAttemptId(createClientId());
                }}
                disabled={mutation.isPending || !sources.length}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-800 disabled:bg-slate-100"
              >
                <option value="">Pilih akun sumber…</option>
                {sources.map((account) => (
                  <option key={account.akun_keuangan_id} value={account.akun_keuangan_id}>
                    {account.nama_akun} · {formatInvestorCurrency(account.saldo, account.mata_uang)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor={`advance-amount-${kind}-${periodStart}`} className="text-[9px] text-slate-500">Nominal dibayarkan</Label>
              <Input
                id={`advance-amount-${kind}-${periodStart}`}
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                max={maxFromSource}
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setAttemptId(createClientId());
                }}
                placeholder="Masukkan nominal"
                disabled={!source || mutation.isPending}
                className="mt-1 h-9 text-[10px]"
              />
              <p className="mt-1 text-[9px] text-slate-400">
                Maksimal {formatInvestorCurrency(maxFromSource, currencyCode)} berdasarkan estimasi hak dan saldo sumber.
              </p>
            </div>
            <div>
              <Label htmlFor={`advance-destination-${kind}-${periodStart}`} className="text-[9px] text-slate-500">Nama penerima</Label>
              <Input
                id={`advance-destination-${kind}-${periodStart}`}
                value={destinationName}
                onChange={(event) => {
                  setDestinationName(event.target.value);
                  setAttemptId(createClientId());
                }}
                placeholder="Nama orang atau tujuan pembayaran"
                disabled={mutation.isPending}
                className="mt-1 h-9 text-[10px]"
              />
            </div>
            <div>
              <Label htmlFor={`advance-reference-${kind}-${periodStart}`} className="text-[9px] text-slate-500">Referensi (opsional)</Label>
              <Input
                id={`advance-reference-${kind}-${periodStart}`}
                value={destinationReference}
                onChange={(event) => {
                  setDestinationReference(event.target.value);
                  setAttemptId(createClientId());
                }}
                placeholder="Nomor bukti atau referensi"
                disabled={mutation.isPending}
                className="mt-1 h-9 text-[10px]"
              />
            </div>
          </div>
          <Input
            aria-label={`Catatan penarikan awal ${kind}`}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setAttemptId(createClientId());
            }}
            placeholder="Catatan (opsional)"
            disabled={mutation.isPending}
            className="mt-2 h-9 text-[10px]"
          />
          <Button
            type="button"
            className="mt-3 h-9 w-full rounded-lg bg-[#10231f] text-[10px] font-semibold text-white hover:bg-[#10231f]/90"
            disabled={
              mutation.isPending ||
              !source ||
              !destinationName.trim() ||
              !Number.isFinite(amountValue) ||
              amountValue <= 0 ||
              amountValue > availableEntitlement ||
              amountValue > (source?.saldo ?? 0)
            }
            onClick={() => {
              if (!source) return;
              const confirmed = window.confirm(
                "Konfirmasi pencatatan pembayaran sebelum periode ditutup?\\n" +
                "Jenis: Penarikan awal " + (kind === "investor" ? "Investor" : "Pengelola") + "\\n" +
                "Periode: " + formatInvestorDate(periodStart) + "\\n" +
                "Sumber: " + source.nama_akun + "\\n" +
                "Nominal: " + formatInvestorCurrency(amountValue, source.mata_uang) + "\\n" +
                "Penerima: " + destinationName.trim() + "\\n\\n" +
                "Uang harus sudah benar-benar dibayarkan. Ini bukan biaya operasional.",
              );
              if (confirmed) mutation.mutate();
            }}
          >
            {mutation.isPending ? "Mencatat penarikan awal…" : "Catat penarikan awal"}
          </Button>
        </>
      )}

      {mutation.error ? (
        <p role="alert" className="mt-2 rounded-lg border border-red-100 bg-red-50 px-2.5 py-2 text-[9px] text-red-700">
          {mutation.error instanceof Error ? mutation.error.message : "Penarikan awal gagal dicatat."}
        </p>
      ) : null}
      {mutation.isSuccess ? (
        <p className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-2 text-[9px] text-emerald-700">
          Pembayaran awal tercatat dan akan direkonsiliasi terhadap alokasi saat periode ditutup. Hasil operasional tidak berkurang oleh pembayaran ini.
        </p>
      ) : null}
    </div>
  );
}


type SettlementAllocationCardProps = {
  kind: "investor" | "pengelola";
  allocation: InvestorPendingAllocation;
  operationalAccounts: FinanceOperationalAccount[];
  usahaId: string;
  onSuccess: () => Promise<void>;
};

function SettlementAllocationCard({
  kind,
  allocation,
  operationalAccounts,
  usahaId,
  onSuccess,
}: SettlementAllocationCardProps) {
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [attemptId, setAttemptId] = useState(() => createClientId());

  const sources = operationalAccounts.filter((account) => account.mata_uang === allocation.currency_code);
  const soleSourceId = sources.length === 1 ? sources[0].akun_keuangan_id : "";
  const [destinationName, setDestinationName] = useState("");
  const [destinationReference, setDestinationReference] = useState("");
  const amountValue = Number(amount);
  const title = kind === "investor" ? "Bayar Investor" : "Bayar Pengelola";

  useEffect(() => {
    if (soleSourceId) setSourceAccountId(soleSourceId);
  }, [soleSourceId]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!usahaId) throw new Error("Usaha aktif belum tersedia.");
      if (!sourceAccountId) throw new Error("Pilih akun usaha sumber.");
      if (!destinationName.trim()) throw new Error("Nama penerima wajib diisi.");
      if (!Number.isFinite(amountValue) || amountValue <= 0 || amountValue > allocation.remaining_amount) {
        throw new Error("Nominal harus lebih dari nol dan tidak melebihi sisa alokasi.");
      }

      // Keep the key short and stable for retries. Any changed input below
      // starts a fresh attempt; identical retries reuse this idempotency key.
      const idempotencyKey = [
        "investor-settlement",
        kind,
        allocation.allocation_id,
        attemptId,
      ].join("-");

      if (kind === "investor") {
        return payoutInvestorBalance({
          usahaId,
          periodStart: allocation.period_start,
          allocationId: allocation.allocation_id,
          sourceAccountId,
          amount: amountValue,
          paidAt: new Date().toISOString(),
          destinationName: destinationName.trim(),
          destinationReference: destinationReference.trim() || null,
          catatan: note.trim() || null,
          idempotencyKey,
          requestId: attemptId,
        });
      }

      return withdrawOperatorBalance({
        usahaId,
        periodStart: allocation.period_start,
        allocationId: allocation.allocation_id,
        sourceAccountId,
        amount: amountValue,
        paidAt: new Date().toISOString(),
        destinationName: destinationName.trim(),
        destinationReference: destinationReference.trim() || null,
        catatan: note.trim() || null,
        idempotencyKey,
        requestId: attemptId,
      });
    },
    onSuccess: async () => {
      setAmount("");
      setDestinationName("");
      setDestinationReference("");
      setNote("");
      setAttemptId(createClientId());
      await onSuccess();
    },
  });

  return (
    <div className="rounded-2xl border border-slate-200 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold text-slate-800">{title}</p>
          <p className="mt-0.5 text-[9px] text-slate-500">Periode {formatInvestorDate(allocation.period_start)} · {allocation.currency_code}</p>
        </div>
        <strong className="text-[11px] font-bold text-slate-900">{formatInvestorCurrency(allocation.remaining_amount, allocation.currency_code)}</strong>
      </div>

      <p className="mt-2 text-[9px] leading-4 text-slate-500">
        Catat hanya saat uang benar-benar dibayarkan ke penerima di luar kas yang dikelola usaha. Transfer antar akun internal tidak dihitung sebagai pembayaran.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={"recipient-" + allocation.allocation_id} className="text-[9px] text-slate-500">Nama penerima</Label>
          <Input
            id={"recipient-" + allocation.allocation_id}
            value={destinationName}
            onChange={(event) => {
              setDestinationName(event.target.value);
              setAttemptId(createClientId());
            }}
            placeholder="Nama orang atau tujuan pembayaran"
            className="mt-1 h-9 text-[10px]"
          />
        </div>
        <div>
          <Label htmlFor={"recipient-ref-" + allocation.allocation_id} className="text-[9px] text-slate-500">Referensi (opsional)</Label>
          <Input
            id={"recipient-ref-" + allocation.allocation_id}
            value={destinationReference}
            onChange={(event) => {
              setDestinationReference(event.target.value);
              setAttemptId(createClientId());
            }}
            placeholder="Contoh: rekening atau bukti"
            className="mt-1 h-9 text-[10px]"
          />
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={"source-" + allocation.allocation_id} className="text-[9px] text-slate-500">Akun Usaha sumber</Label>
          <select
            id={"source-" + allocation.allocation_id}
            value={sourceAccountId}
            onChange={(event) => {
              setSourceAccountId(event.target.value);
              setAttemptId(createClientId());
            }}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-800"
          >
            <option value="">Pilih sumber…</option>
            {sources.map((account) => (
              <option key={account.akun_keuangan_id} value={account.akun_keuangan_id}>
                {account.nama_akun} · {formatInvestorCurrency(account.saldo, account.mata_uang)}
              </option>
            ))}
          </select>
          {!sources.length ? <p className="mt-1 text-[9px] text-amber-700">Tidak ada akun operasional dengan mata uang yang cocok.</p> : null}
        </div>
        <div>
          <Label htmlFor={"amount-" + allocation.allocation_id} className="text-[9px] text-slate-500">Nominal pencairan</Label>
          <Input
            id={"amount-" + allocation.allocation_id}
            type="number"
            inputMode="decimal"
            min="1"
            max={allocation.remaining_amount}
            step="0.01"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setAttemptId(createClientId());
            }}
            placeholder="Masukkan nominal"
            className="mt-1 h-9 text-[10px]"
          />
        </div>
      </div>

      <Input
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
          setAttemptId(createClientId());
        }}
        placeholder="Catatan (opsional)"
        className="mt-2 h-9 text-[10px]"
        aria-label={"Catatan " + title}
      />

      <Button
        type="button"
        className="mt-2 h-9 w-full rounded-lg bg-[#10231f] text-[10px] font-semibold text-white hover:bg-[#10231f]/90"
        disabled={
          mutation.isPending ||
          !destinationName.trim() ||
          !sourceAccountId ||
          !Number.isFinite(amountValue) ||
          amountValue <= 0 ||
          amountValue > allocation.remaining_amount
        }
        onClick={() => {
          if (window.confirm(`Konfirmasi pembayaran keluar sebesar ${formatInvestorCurrency(amountValue, allocation.currency_code)} kepada ${destinationName.trim()}? Tindakan ini mengurangi saldo akun sumber dan mencatat pembayaran aktual, bukan beban operasional.`)) {
            mutation.mutate();
          }
        }}
      >
        {mutation.isPending ? "Mencatat pembayaran…" : "Catat " + title}
      </Button>

      {mutation.error ? <p className="mt-2 text-[9px] text-red-600">{mutation.error instanceof Error ? mutation.error.message : "Pencairan gagal diproses."}</p> : null}
      {mutation.isSuccess ? <p className="mt-2 text-[9px] text-emerald-700">Pencairan tercatat. Sisa alokasi telah diperbarui.</p> : null}
    </div>
  );
}


type InvestorEntitlementTransferCardProps = {
  allocation: InvestorPendingAllocation;
  operationalAccounts: FinanceOperationalAccount[];
  stakeholderAccounts: InvestorStakeholderAccount[];
  operatorAllocations: InvestorPendingAllocation[];
  usahaId: string;
  onSuccess: () => Promise<void>;
};

function InvestorEntitlementTransferCard({
  allocation,
  operationalAccounts,
  stakeholderAccounts,
  operatorAllocations,
  usahaId,
  onSuccess,
}: InvestorEntitlementTransferCardProps) {
  const [targetType, setTargetType] = useState<"usaha" | "pengelola">("usaha");
  const [targetOperatorAllocationId, setTargetOperatorAllocationId] = useState("");
  const [movePhysicalMoney, setMovePhysicalMoney] = useState(false);
  const [physicalSourceAccountId, setPhysicalSourceAccountId] = useState("");
  const [physicalTargetAccountId, setPhysicalTargetAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [attemptId, setAttemptId] = useState(() => createClientId());

  const eligibleOperatorAllocations = operatorAllocations.filter((item) =>
    item.period_start === allocation.period_start &&
    item.currency_code === allocation.currency_code &&
    item.status !== "review_required" &&
    (item.advance_excess_amount ?? 0) === 0
  );
  const selectedOperator = eligibleOperatorAllocations.find(
    (item) => item.allocation_id === targetOperatorAllocationId,
  );
  const physicalSources = [
    ...operationalAccounts
      .filter((account) => account.mata_uang === allocation.currency_code)
      .map((account) => ({
        id: account.akun_keuangan_id,
        name: account.nama_akun,
        kind: "Akun usaha",
        balance: account.saldo,
      })),
    ...stakeholderAccounts
      .filter((account) =>
        account.fungsi_akun === "investor" &&
        account.investor_id === allocation.investor_id &&
        account.mata_uang === allocation.currency_code
      )
      .map((account) => ({
        id: account.akun_keuangan_id,
        name: account.nama_akun,
        kind: "Akun Investor",
        balance: account.saldo,
      })),
  ];
  const physicalTargets = targetType === "usaha"
    ? operationalAccounts
        .filter((account) => account.mata_uang === allocation.currency_code)
        .map((account) => ({
          id: account.akun_keuangan_id,
          name: account.nama_akun,
          kind: "Akun usaha",
          balance: account.saldo,
        }))
    : stakeholderAccounts
        .filter((account) =>
          account.fungsi_akun === "pengelola" &&
          account.pengelola_akun_admin_id === selectedOperator?.pengelola_akun_admin_id &&
          account.mata_uang === allocation.currency_code
        )
        .map((account) => ({
          id: account.akun_keuangan_id,
          name: account.nama_akun,
          kind: "Akun Pengelola",
          balance: account.saldo,
        }));
  const amountValue = Number(amount);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!usahaId) throw new Error("Usaha aktif belum tersedia.");
      if (!Number.isFinite(amountValue) || amountValue <= 0 || amountValue > allocation.remaining_amount) {
        throw new Error("Nominal harus lebih dari nol dan tidak melebihi sisa hak Investor.");
      }
      if (targetType === "pengelola" && !selectedOperator) {
        throw new Error("Pilih alokasi Pengelola dari periode dan mata uang yang sama.");
      }
      if (movePhysicalMoney) {
        if (!physicalSourceAccountId || !physicalTargetAccountId) {
          throw new Error("Pilih akun sumber dan tujuan uang fisik.");
        }
        if (physicalSourceAccountId === physicalTargetAccountId) {
          throw new Error("Akun sumber dan tujuan harus berbeda.");
        }
      }
      const idempotencyKey = ["inv-right", allocation.allocation_id, attemptId].join("-");
      return transferInvestorEntitlement({
        usahaId,
        sourceInvestorAllocationId: allocation.allocation_id,
        targetType,
        targetOperatorAllocationId: targetType === "pengelola" ? selectedOperator?.allocation_id : null,
        amount: amountValue,
        transferredAt: new Date().toISOString(),
        physicalSourceAccountId: movePhysicalMoney ? physicalSourceAccountId : null,
        physicalTargetAccountId: movePhysicalMoney ? physicalTargetAccountId : null,
        catatan: note.trim() || null,
        idempotencyKey,
        requestId: attemptId,
      });
    },
    onSuccess: async () => {
      setAmount("");
      setNote("");
      setAttemptId(createClientId());
      await onSuccess();
    },
  });

  return (
    <details className="rounded-2xl border border-dashed border-slate-300 px-3 py-3">
      <summary className="cursor-pointer text-[10px] font-bold text-slate-800">
        Alihkan hak Investor · sisa {formatInvestorCurrency(allocation.remaining_amount, allocation.currency_code)}
      </summary>
      <p className="mt-2 text-[9px] leading-4 text-slate-500">
        Mengubah penerima hak, bukan hasil operasional. Uang tidak berpindah kecuali opsi pemindahan uang fisik diaktifkan.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={"right-target-" + allocation.allocation_id} className="text-[9px] text-slate-500">Hak dialihkan ke</Label>
          <select
            id={"right-target-" + allocation.allocation_id}
            value={targetType}
            onChange={(event) => {
              setTargetType(event.target.value as "usaha" | "pengelola");
              setTargetOperatorAllocationId("");
              setPhysicalTargetAccountId("");
              setAttemptId(createClientId());
            }}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-800"
          >
            <option value="usaha">Usaha</option>
            <option value="pengelola">Pengelola</option>
          </select>
        </div>
        {targetType === "pengelola" ? (
          <div>
            <Label htmlFor={"right-operator-" + allocation.allocation_id} className="text-[9px] text-slate-500">Alokasi Pengelola</Label>
            <select
              id={"right-operator-" + allocation.allocation_id}
              value={targetOperatorAllocationId}
              onChange={(event) => {
                setTargetOperatorAllocationId(event.target.value);
                setPhysicalTargetAccountId("");
                setAttemptId(createClientId());
              }}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-800"
            >
              <option value="">Pilih alokasi periode sama…</option>
              {eligibleOperatorAllocations.map((item) => (
                <option key={item.allocation_id} value={item.allocation_id}>
                  {formatInvestorDate(item.period_start)} · sisa {formatInvestorCurrency(item.remaining_amount, item.currency_code)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <Label htmlFor={"right-amount-" + allocation.allocation_id} className="text-[9px] text-slate-500">Nominal hak</Label>
          <Input
            id={"right-amount-" + allocation.allocation_id}
            type="number"
            inputMode="decimal"
            min="1"
            max={allocation.remaining_amount}
            step="0.01"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setAttemptId(createClientId());
            }}
            placeholder="Masukkan nominal"
            className="mt-1 h-9 text-[10px]"
          />
        </div>
      </div>
      <label className="mt-3 flex items-start gap-2 text-[9px] leading-4 text-slate-600">
        <input
          type="checkbox"
          checked={movePhysicalMoney}
          onChange={(event) => {
            setMovePhysicalMoney(event.target.checked);
            setPhysicalSourceAccountId("");
            setPhysicalTargetAccountId("");
            setAttemptId(createClientId());
          }}
          className="mt-0.5"
        />
        Catat juga pemindahan uang antar akun sekarang
      </label>
      {movePhysicalMoney ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor={"right-source-account-" + allocation.allocation_id} className="text-[9px] text-slate-500">Akun sumber uang</Label>
            <select
              id={"right-source-account-" + allocation.allocation_id}
              value={physicalSourceAccountId}
              onChange={(event) => {
                setPhysicalSourceAccountId(event.target.value);
                setAttemptId(createClientId());
              }}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-800"
            >
              <option value="">Pilih akun sumber…</option>
              {physicalSources.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.kind} · {account.name} · {formatInvestorCurrency(account.balance, allocation.currency_code)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor={"right-target-account-" + allocation.allocation_id} className="text-[9px] text-slate-500">Akun tujuan uang</Label>
            <select
              id={"right-target-account-" + allocation.allocation_id}
              value={physicalTargetAccountId}
              onChange={(event) => {
                setPhysicalTargetAccountId(event.target.value);
                setAttemptId(createClientId());
              }}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-800"
            >
              <option value="">Pilih akun tujuan…</option>
              {physicalTargets.map((account) => (
                <option key={account.id} value={account.id} disabled={account.id === physicalSourceAccountId}>
                  {account.kind} · {account.name} · {formatInvestorCurrency(account.balance, allocation.currency_code)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
      <Input
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
          setAttemptId(createClientId());
        }}
        placeholder="Catatan (opsional)"
        aria-label={"Catatan alih hak Investor " + allocation.allocation_id}
        className="mt-2 h-9 text-[10px]"
      />
      <Button
        type="button"
        className="mt-2 h-9 w-full rounded-lg bg-[#10231f] text-[10px] font-semibold text-white hover:bg-[#10231f]/90"
        disabled={
          mutation.isPending ||
          !Number.isFinite(amountValue) ||
          amountValue <= 0 ||
          amountValue > allocation.remaining_amount ||
          (targetType === "pengelola" && (!selectedOperator || !eligibleOperatorAllocations.length)) ||
          (movePhysicalMoney && (!physicalSourceAccountId || !physicalTargetAccountId || physicalSourceAccountId === physicalTargetAccountId))
        }
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Memindahkan hak…" : "Alihkan hak"}
      </Button>
      {mutation.error ? <p className="mt-2 text-[9px] text-red-600">{mutation.error instanceof Error ? mutation.error.message : "Alih hak gagal diproses."}</p> : null}
      {mutation.isSuccess ? <p className="mt-2 text-[9px] text-emerald-700">Hak berhasil dialihkan. Riwayat dan sisa hak diperbarui.</p> : null}
    </details>
  );
}

function TransactionsTab({
  items,
  onSelect,
  usahaId,
  period,
}: {
  items: InvestorActivityItem[];
  onSelect: (item: InvestorActivityItem) => void;
  usahaId: string;
  period: PeriodRange;
}) {
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const exportMutation = useMutation({
    mutationFn: () => getInvestorActivityExport(usahaId, period.start, period.endExclusive),
  });
  const filtered = filter === "all" ? items : items.filter((item) => item.direction === filter);

  const exportCsv = async () => {
    const result = await exportMutation.mutateAsync();
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Waktu","Nomor Transaksi","Jenis","Jumlah","Dampak Investor","Mata Uang","Sumber","Kategori"],
      ...result.items.map((item) => [
        item.occurred_at,
        item.nomor_transaksi,
        item.direction,
        item.amount,
        item.investor_impact,
        item.currency_code,
        item.source_type ?? "",
        item.expense_category ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `investor-${period.start}-${period.endExclusive}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        {[
          ["all", "Semua"],
          ["income", "Pemasukan"],
          ["expense", "Pengeluaran"],
        ].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setFilter(key as "all" | "income" | "expense")} className={cn("rounded-full px-3 py-1.5 text-[9px] font-semibold", filter === key ? "bg-emerald-500 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200")}>
            {label}
          </button>
        ))}
        <Button
          type="button"
          variant="outline"
          className="ml-auto h-8 rounded-full px-3 text-[9px]"
          disabled={exportMutation.isPending}
          onClick={() => void exportCsv()}
        >
          {exportMutation.isPending ? "Menyiapkan…" : "Export CSV"}
        </Button>
      </div>
      {exportMutation.error ? (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-[9px] text-orange-700">
          {exportMutation.error instanceof Error ? exportMutation.error.message : "Export gagal diproses."}
        </div>
      ) : null}
      <Card className="overflow-hidden rounded-[20px] border-slate-200/75 bg-white shadow-[0_5px_20px_rgba(30,68,57,.04)]">
        <div className="divide-y divide-slate-100">
          {filtered.map((item) => {
            const positive = item.direction === "income";
            return (
              <button key={item.transaksi_keuangan_id} type="button" onClick={() => onSelect(item)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left sm:px-4">
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", positive ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-600")}>
                  {positive ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-bold text-slate-800">{item.activity_reason}</span>
                  <span className="block truncate text-[9px] text-slate-400">{item.nomor_transaksi}</span>
                  <span className="mt-0.5 block text-[8px] text-slate-400">{formatInvestorDateTime(item.occurred_at)} · {item.source_type ?? "Finance"}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={cn("block text-[11px] font-bold", positive ? "text-emerald-600" : "text-orange-600")}>{positive ? "+" : "−"}{compactCurrency(Math.abs(item.amount))}</span>
                  <span className="block text-[8px] text-slate-400">Dampak {item.investor_impact >= 0 ? "+" : "−"}{compactCurrency(Math.abs(item.investor_impact))}</span>
                </span>
              </button>
            );
          })}
          {!filtered.length ? <div className="p-8 text-center text-[10px] text-slate-400">Tidak ada transaksi untuk filter ini.</div> : null}
        </div>
      </Card>
    </div>
  );
}

function SummaryTab({
  overview,
  previous,
  activities,
  onSelect,
}: {
  overview: InvestorOverview;
  previous?: InvestorOverview | null;
  activities: InvestorActivityItem[];
  onSelect: (item: InvestorActivityItem) => void;
}) {
  const incomeDelta = safePercent(overview.income_recorded, previous?.income_recorded);
  const expenseDelta = safePercent(overview.expense_recorded, previous?.expense_recorded);
  const netDelta = safePercent(overview.net_operational_result, previous?.net_operational_result);

  return (
    <div className="space-y-3">
      <HeroInvestor overview={overview} />
      <div className="grid grid-cols-3 gap-2">
        <SmallKpi title="Pemasukan" value={compactCurrency(overview.income_recorded)} delta={incomeDelta == null ? null : `${incomeDelta >= 0 ? "▲" : "▼"} ${Math.abs(incomeDelta).toFixed(1).replace(".", ",")}%`} tone="income" />
        <SmallKpi title="Pengeluaran" value={compactCurrency(overview.expense_recorded)} delta={expenseDelta == null ? null : `${expenseDelta >= 0 ? "▲" : "▼"} ${Math.abs(expenseDelta).toFixed(1).replace(".", ",")}%`} tone="expense" />
        <SmallKpi title="Hasil Bersih" value={compactCurrency(overview.net_operational_result)} delta={netDelta == null ? null : `${netDelta >= 0 ? "▲" : "▼"} ${Math.abs(netDelta).toFixed(1).replace(".", ",")}%`} tone="net" />
      </div>
      <WhyChanges current={overview} previous={previous} activities={activities} />
      <RecentActivity items={activities} onSelect={onSelect} />
      <div className="hidden md:block">
        <CalculationSummary overview={overview} />
      </div>
    </div>
  );
}

export function InvestorAccountTransferCard({
  dashboard,
  onSuccess,
}: {
  dashboard: ReturnType<typeof useInvestorDashboard>;
  onSuccess: () => Promise<void>;
}) {
  const investorId = dashboard.principal.data?.investorId;
  const usahaId = dashboard.principal.data?.usahaId;
  const ownAccounts = (dashboard.stakeholderAccounts.data?.accounts ?? []).filter(
    (account) => account.fungsi_akun === "investor" && account.investor_id === investorId,
  );
  const transferTargets = dashboard.stakeholderAccounts.data?.transfer_targets ?? [];
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [targetAccountId, setTargetAccountId] = useState("");
  const [catatan, setCatatan] = useState("");
  const [amount, setAmount] = useState("");
  const [attemptId, setAttemptId] = useState(() => createClientId());

  useEffect(() => {
    if (!ownAccounts.length) {
      setSourceAccountId("");
      return;
    }
    if (!ownAccounts.some((account) => account.akun_keuangan_id === sourceAccountId)) {
      setSourceAccountId(ownAccounts.length === 1 ? ownAccounts[0].akun_keuangan_id : "");
    }
  }, [ownAccounts, sourceAccountId]);

  const source = ownAccounts.find((account) => account.akun_keuangan_id === sourceAccountId);
  const eligibleTargets = transferTargets.filter((target) =>
    target.akun_keuangan_id !== sourceAccountId &&
    target.mata_uang === source?.mata_uang &&
    (target.fungsi_akun === "operasional" || target.fungsi_akun === "investor"),
  );
  const target = eligibleTargets.find((item) => item.akun_keuangan_id === targetAccountId);
  const amountValue = Number(amount);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!usahaId || !investorId) throw new Error("Identitas Investor aktif belum tersedia.");
      if (!source) throw new Error("Pilih saldo Investor milik Anda sebagai sumber.");
      if (!target) throw new Error("Pilih akun tujuan aktif dengan mata uang yang sama.");
      if (!Number.isFinite(amountValue) || amountValue <= 0 || amountValue > source.saldo) {
        throw new Error("Nominal harus lebih dari nol dan tidak melebihi saldo akun sumber.");
      }
      return transferInvestorAccountBalance({
        usahaId,
        sourceAccountId: source.akun_keuangan_id,
        targetAccountId: target.akun_keuangan_id,
        amount: amountValue,
        transferredAt: new Date().toISOString(),
        catatan: catatan.trim() || null,
        idempotencyKey: "investor-account-transfer-" + attemptId,
        requestId: attemptId,
      });
    },
    onSuccess: async () => {
      setAmount("");
      setTargetAccountId("");
      setCatatan("");
      setAttemptId(createClientId());
      await onSuccess();
    },
  });

  return (
    <Card className="rounded-[20px] border-slate-200/75 bg-white p-3 shadow-[0_5px_20px_rgba(30,68,57,.04)] sm:p-4">
      <SectionTitle title="Saldo Investor & Transfer Internal" />
      <p className="mt-1 text-[9px] leading-4 text-slate-500">
        Pindahkan saldo tercatat dari akun Investor milik Anda ke Akun Usaha atau akun Investor lain. Transfer ini hanya mencatat perpindahan uang di dalam usaha; tidak mengirim uang ke bank, tidak menjadi pemasukan/pengeluaran, dan tidak mengubah hak alokasi.
      </p>

      <div className="mt-3 space-y-2">
        {ownAccounts.map((account) => (
          <div key={account.akun_keuangan_id} className="flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5">
            <div className="min-w-0">
              <p className="break-words text-[10px] font-semibold text-slate-800">{account.nama_akun}</p>
              <p className="text-[9px] text-slate-500">Saldo tercatat · {account.mata_uang}</p>
            </div>
            <strong className="shrink-0 text-[11px] text-slate-900">{formatInvestorCurrency(account.saldo, account.mata_uang)}</strong>
          </div>
        ))}
        {!dashboard.stakeholderAccounts.isLoading && !ownAccounts.length ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-[10px] text-slate-500">
            Belum ada akun saldo Investor yang ditetapkan untuk identitas Anda. Minta admin memeriksa Konfigurasi Investor pada halaman Keuangan.
          </p>
        ) : null}
        {dashboard.stakeholderAccounts.isLoading ? (
          <p className="rounded-xl bg-slate-50 p-3 text-[10px] text-slate-500">Memuat saldo rekening Investor…</p>
        ) : null}
        {dashboard.stakeholderAccounts.error ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800">
            Saldo rekening belum dapat diverifikasi. Segarkan data sebelum mencatat transfer.
          </p>
        ) : null}
      </div>

      <div className="mt-4 rounded-xl border border-slate-100 p-3">
        <p className="text-[10px] font-bold text-slate-800">Catat transfer antarakun</p>
        <p className="mt-1 text-[9px] leading-4 text-slate-500">
          Pilih akun tujuan internal. Akun Pengelola tidak ditawarkan sebagai tujuan transfer langsung; alokasi hak Pengelola tetap menggunakan alur hak yang terpisah.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="investor-transfer-source" className="text-[9px] text-slate-500">Akun sumber</Label>
            <select
              id="investor-transfer-source"
              value={sourceAccountId}
              onChange={(event) => {
                setSourceAccountId(event.target.value);
                setTargetAccountId("");
                setAttemptId(createClientId());
              }}
              disabled={!ownAccounts.length || mutation.isPending}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-800 disabled:bg-slate-50"
            >
              <option value="">Pilih saldo Investor…</option>
              {ownAccounts.map((account) => (
                <option key={account.akun_keuangan_id} value={account.akun_keuangan_id}>
                  {account.nama_akun} · {formatInvestorCurrency(account.saldo, account.mata_uang)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="investor-transfer-target" className="text-[9px] text-slate-500">Akun tujuan internal</Label>
            <select
              id="investor-transfer-target"
              value={targetAccountId}
              onChange={(event) => {
                setTargetAccountId(event.target.value);
                setAttemptId(createClientId());
              }}
              disabled={!source || !eligibleTargets.length || mutation.isPending}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-800 disabled:bg-slate-50"
            >
              <option value="">Pilih tujuan…</option>
              {eligibleTargets.map((account) => (
                <option key={account.akun_keuangan_id} value={account.akun_keuangan_id}>
                  {account.nama_akun} · {account.fungsi_akun === "operasional" ? "Akun Usaha" : "Investor"} {account.nama_pemilik ? "· " + account.nama_pemilik : ""}
                </option>
              ))}
            </select>
            {source && !eligibleTargets.length ? <p className="mt-1 text-[9px] text-amber-700">Belum ada akun tujuan aktif bermata uang {source.mata_uang}.</p> : null}
          </div>
          <div>
            <Label htmlFor="investor-transfer-amount" className="text-[9px] text-slate-500">Nominal transfer</Label>
            <Input
              id="investor-transfer-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              max={source?.saldo ?? 0}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setAttemptId(createClientId());
              }}
              placeholder="Masukkan nominal"
              disabled={!source || mutation.isPending}
              className="mt-1 h-9 text-[10px]"
            />
            {source ? <p className="mt-1 text-[9px] text-slate-400">Maksimal {formatInvestorCurrency(source.saldo, source.mata_uang)}.</p> : null}
          </div>
          <div>
            <Label htmlFor="investor-transfer-note" className="text-[9px] text-slate-500">Catatan (opsional)</Label>
            <Input
              id="investor-transfer-note"
              value={catatan}
              onChange={(event) => {
                setCatatan(event.target.value);
                setAttemptId(createClientId());
              }}
              placeholder="Catatan perpindahan saldo"
              disabled={mutation.isPending}
              className="mt-1 h-9 text-[10px]"
            />
          </div>
        </div>
        <Button
          type="button"
          className="mt-3 h-9 w-full rounded-lg bg-[#10231f] text-[10px] font-semibold text-white hover:bg-[#10231f]/90"
          disabled={
            mutation.isPending || dashboard.stakeholderAccounts.isLoading || dashboard.stakeholderAccounts.isError ||
            !source || !target || !Number.isFinite(amountValue) || amountValue <= 0 || amountValue > (source?.saldo ?? 0)
          }
          onClick={() => {
            if (!source || !target) return;
            const confirmed = window.confirm(
              "Konfirmasi transfer internal saldo Investor?\n" +
              "Sumber: " + source.nama_akun + "\n" +
              "Tujuan: " + target.nama_akun + "\n" +
              "Nominal: " + formatInvestorCurrency(amountValue, source.mata_uang) + "\n\n" +
              "Transfer dicatat antarakun. Hasil operasional dan hak alokasi tidak berubah.",
            );
            if (confirmed) mutation.mutate();
          }}
        >
          {mutation.isPending ? "Mencatat transfer…" : "Catat Transfer Internal"}
        </Button>
        {mutation.error ? (
          <p role="alert" className="mt-2 rounded-lg border border-red-100 bg-red-50 px-2.5 py-2 text-[9px] text-red-700">
            {mutation.error instanceof Error ? mutation.error.message : "Transfer internal gagal dicatat."}
          </p>
        ) : null}
        {mutation.isSuccess ? (
          <p role="status" className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-2 text-[9px] text-emerald-700">
            Transfer internal tercatat. Saldo kedua akun dan riwayat telah diperbarui.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

export function InvestorDashboard({ usahaId: usahaIdOverride }: { usahaId?: string | null } = {}) {
  const identity = useGetIdentity<PrincipalIdentity>();
  const dashboard = useInvestorDashboard(usahaIdOverride ?? identity.data?.usahaId ?? undefined);
  const [params, setParams] = useSearchParams();
  const [selectedAsOfDate, setSelectedAsOfDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<InvestorActivityItem | null>(null);
  const requestedTab = params.get("tab");
  const tab: InvestorTab = requestedTab === "performance" || requestedTab === "transactions" || requestedTab === "accounts"
    ? requestedTab
    : "summary";
  const stakeholderHistory = useQuery({
    queryKey: ["investor", "stakeholder-history", dashboard.principal.data?.usahaId],
    queryFn: () => getInvestorStakeholderHistory(dashboard.principal.data?.usahaId as string),
    enabled: Boolean(dashboard.principal.data?.usahaId && tab === "accounts"),
    staleTime: 15_000,
    refetchOnReconnect: true,
  });
  const refreshFinanceAndHistory = async () => {
    await dashboard.refetch();
    await stakeholderHistory.refetch();
  };

  const basePeriod = dashboard.overview.data?.period
    ? { start: dashboard.overview.data.period.start, endExclusive: dashboard.overview.data.period.end_exclusive }
    : null;

  // Resolve every selected period through the effective-dated backend config.
  // Do not construct arbitrary ranges on the client: configured start/end days
  // and historical snapshots belong to the server contract.
  const selectedPeriod = useQuery({
    queryKey: ["investor", "ui-period", dashboard.principal.data?.usahaId, selectedAsOfDate],
    queryFn: () => getInvestorOverview(dashboard.principal.data?.usahaId as string, selectedAsOfDate as string),
    enabled: Boolean(selectedAsOfDate && dashboard.principal.data?.usahaId),
    staleTime: 15_000,
    refetchOnReconnect: true,
  });
  const overview = selectedAsOfDate ? selectedPeriod.data : dashboard.overview.data;
  const period = overview?.period
    ? { start: overview.period.start, endExclusive: overview.period.end_exclusive }
    : null;

  const selectedActivity = useQuery({
    queryKey: ["investor", "ui-activity", dashboard.principal.data?.usahaId, period?.start, period?.endExclusive],
    queryFn: () => getInvestorActivity(
      dashboard.principal.data?.usahaId as string,
      period!.start,
      period!.endExclusive,
      100,
      0,
    ),
    enabled: Boolean(selectedAsOfDate && dashboard.principal.data?.usahaId && period),
    staleTime: 15_000,
    refetchOnReconnect: true,
  });
  const activities = selectedAsOfDate
    ? selectedActivity.data?.items ?? []
    : dashboard.activity.data?.items ?? [];

  const previous = useQuery({
    queryKey: ["investor", "ui-previous", dashboard.principal.data?.usahaId, period?.start],
    queryFn: () => getInvestorOverview(
      dashboard.principal.data?.usahaId as string,
      addCalendarDays(period!.start, -1),
    ),
    enabled: Boolean(period && dashboard.principal.data?.usahaId),
    staleTime: 15_000,
  });

  const selectedContract = overview
    ? buildInvestorUiContract(overview, dashboard.connectionStatus)
    : null;

  const closeMutation = useMutation({
    mutationFn: () => {
      if (
        !period ||
        !dashboard.principal.data?.usahaId ||
        overview?.principal !== "admin" ||
        overview.period_state !== "OPEN" ||
        selectedContract?.capabilities.closePeriod !== "SERVER_GUARDED"
      ) {
        throw new Error("Hanya periode terbuka yang sudah melewati tanggal akhirnya dapat ditutup oleh admin usaha.");
      }
      return closeInvestorPeriod({
        usahaId: dashboard.principal.data.usahaId,
        periodStart: period.start,
        idempotencyKey: "investor-close-" + dashboard.principal.data.usahaId + "-" + period.start,
        requestId: createClientId(),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        dashboard.refetch(),
        ...(selectedAsOfDate ? [selectedPeriod.refetch()] : []),
        ...(selectedAsOfDate ? [selectedActivity.refetch()] : []),
        stakeholderHistory.refetch(),
      ]);
      setSelected(null);
    },
  });

  const setTab = (next: InvestorTab) => {
    const nextParams = new URLSearchParams(params);
    if (next === "summary") nextParams.delete("tab");
    else nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const movePeriod = (direction: -1 | 1) => {
    if (!period || !basePeriod) return;
    if (direction < 0) {
      setSelectedAsOfDate(addCalendarDays(period.start, -1));
      return;
    }

    // Navigate to the next backend-configured monthly anchor, not
    // endExclusive + 1. The end-day can precede month-end; and when a config
    // changes mid-history its effective_from can become the next period anchor.
    if (period.start >= basePeriod.start) return;
    const participationRows = dashboard.participation.data?.items ?? [];
    const periodConfig = participationRows.find((item) =>
      item.effective_from <= period.start &&
      (item.effective_until === null || item.effective_until > period.start)
    );
    const configuredNextAnchor = periodConfig
      ? configuredMonthAnchor(period.start, 1, periodConfig.period_start_day)
      : addCalendarMonthsClamped(period.start, 1);
    const nextEffectiveDate = participationRows
      .map((item) => item.effective_from)
      .filter((effectiveFrom) => effectiveFrom > period.start)
      .sort((a, b) => a.localeCompare(b))[0];
    const nextAnchor = nextEffectiveDate && nextEffectiveDate < configuredNextAnchor
      ? nextEffectiveDate
      : configuredNextAnchor;
    if (nextAnchor >= basePeriod.start) {
      setSelectedAsOfDate(null);
    } else {
      setSelectedAsOfDate(nextAnchor);
    }
  };

  const isCurrentPeriod = Boolean(period && basePeriod && period.start === basePeriod.start);
  const canNext = Boolean(
    period && basePeriod && period.start < basePeriod.start && dashboard.participation.isSuccess
  );
  if (dashboard.principal.isLoading || dashboard.overview.isLoading || identity.isLoading || (selectedAsOfDate && selectedPeriod.isLoading)) {
    return <div className="mx-auto w-full max-w-[1180px] space-y-3 px-3 pb-24 pt-4 sm:px-5"><div className="h-14 animate-pulse rounded-2xl bg-white" /><div className="h-48 animate-pulse rounded-2xl bg-white" /><div className="h-32 animate-pulse rounded-2xl bg-white" /></div>;
  }

  if (selectedAsOfDate && selectedPeriod.error) {
    return (
      <div className="mx-auto max-w-xl p-5">
        <Card className="rounded-[20px] border-amber-200 p-6 text-center">
          <CalendarDays className="mx-auto size-7 text-amber-600" />
          <p className="mt-3 text-sm font-semibold">Periode tidak dapat dimuat</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Backend tidak dapat memverifikasi konfigurasi dan hasil pada tanggal {formatInvestorDate(selectedAsOfDate)}.
            Tidak ada rentang periode yang dibuat sendiri oleh tampilan.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setSelectedAsOfDate(null)}>Kembali ke periode berjalan</Button>
            <Button className="rounded-xl" onClick={() => void selectedPeriod.refetch()}>Coba lagi</Button>
          </div>
        </Card>
      </div>
    );
  }

  if (dashboard.overview.error) {
    return <div className="mx-auto max-w-xl p-5"><Card className="rounded-[20px] border-red-200 p-6 text-center"><p className="text-sm font-semibold">Dashboard Investor gagal dimuat.</p><p className="mt-1 text-xs text-slate-500">{dashboard.overview.error instanceof Error ? dashboard.overview.error.message : "Terjadi kesalahan saat mengambil data."}</p><Button className="mt-4 rounded-xl" onClick={() => void dashboard.refetch()}><RefreshCw className="mr-2 size-3.5" />Coba lagi</Button></Card></div>;
  }

  if (selectedAsOfDate && overview?.status === "NO_INVESTOR_CONFIG") {
    return (
      <div className="mx-auto max-w-xl p-5">
        <Card className="rounded-[20px] border-dashed p-7 text-center">
          <CalendarDays className="mx-auto size-7 text-slate-400" />
          <p className="mt-3 text-sm font-semibold">Konfigurasi belum berlaku pada tanggal ini</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Tidak ada konfigurasi Investor efektif untuk {formatInvestorDate(selectedAsOfDate)}. Pilih periode yang memiliki konfigurasi tercatat atau kembali ke periode berjalan.
          </p>
          <Button className="mt-4 rounded-xl" onClick={() => setSelectedAsOfDate(null)}>Kembali ke periode berjalan</Button>
        </Card>
      </div>
    );
  }

  if (!dashboard.principal.data || !overview || overview.status === "NO_INVESTOR_CONFIG") {
    return <div className="mx-auto max-w-xl p-5"><Card className="rounded-[20px] border-dashed p-8 text-center"><CircleDollarSign className="mx-auto size-8 text-slate-400" /><p className="mt-3 text-sm font-semibold">Konfigurasi investor belum tersedia</p><p className="mt-1 text-xs leading-5 text-slate-500">Dashboard menunggu investor aktif dan partisipasi efektif.</p></Card></div>;
  }

  const stale = dashboard.connectionStatus === "STALE" || overview.freshness === "LAGGING";
  const reviewRequired = overview.allocation_status === "MULTI_CURRENCY_REVIEW_REQUIRED";
  const timestamp = dashboard.lastRealtimeEventAt ?? overview.calculated_at ?? overview.finance_last_changed_at;
  const canCloseSelectedPeriod = Boolean(
    overview.principal === "admin" &&
    overview.period_state === "OPEN" &&
    selectedContract?.capabilities.closePeriod === "SERVER_GUARDED" &&
    period?.endExclusive &&
    businessDate(overview.period?.timezone ?? "Asia/Jakarta") >= period.endExclusive &&
    !stale &&
    !reviewRequired
  );
  const canRecordOpenAdvance = Boolean(
    overview.principal === "admin" &&
    overview.period_state === "OPEN" &&
    selectedContract?.capabilities.recordOpenAdvance === "SERVER_GUARDED" &&
    isCurrentPeriod &&
    period?.endExclusive &&
    businessDate(overview.period?.timezone ?? "Asia/Jakarta") < period.endExclusive &&
    !stale &&
    !reviewRequired
  );

  return (
    <div className="min-h-[calc(100svh-1px)] bg-[#f5f7f6]">
      <div className="mx-auto w-full max-w-[1180px] px-3 pb-24 pt-0 sm:px-5 md:pb-10 md:px-6">
        <PeriodHeader
          period={period!}
          onPrevious={() => movePeriod(-1)}
          onNext={() => movePeriod(1)}
          onToday={() => setSelectedAsOfDate(null)}
          stale={stale}
          reviewRequired={reviewRequired}
          connectionStatus={dashboard.connectionStatus}
          timestamp={timestamp}
          periodState={overview.period_state ?? "OPEN"}
          isCurrentPeriod={isCurrentPeriod}
          canNext={canNext}
        />

        <div className="sm:hidden">
          <LiveStatus stale={stale} reviewRequired={reviewRequired} connectionStatus={dashboard.connectionStatus} timestamp={timestamp} />
        </div>

        {reviewRequired ? (
          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[9px] text-amber-800">Perhitungan investor memerlukan review karena terdapat lebih dari satu mata uang operasional.</div>
        ) : stale ? (
          <div className="mt-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-[9px] text-orange-800">Data mungkin sudah berubah. Perbarui sebelum melanjutkan.</div>
        ) : null}

        <TabBar tab={tab} onTab={setTab} />

        <main className="mt-3">
          {tab === "summary" ? (
            <SummaryTab overview={overview} previous={previous.data} activities={activities} onSelect={setSelected} />
          ) : null}

          {tab === "performance" ? (
            <div className="space-y-3">
              <PerformanceChart items={activities} />
              <div className="grid gap-3 lg:grid-cols-[1.25fr_.75fr]">
                <InvestorImpactChart items={activities} />
                <ExpenseRatio overview={overview} />
              </div>
              <div className="hidden md:block">
                <CalculationSummary overview={overview} />
              </div>
            </div>
          ) : null}

          {tab === "transactions" ? (
            dashboard.principal.data?.usahaId && period ? (
              <TransactionsTab
                items={activities}
                onSelect={setSelected}
                usahaId={dashboard.principal.data.usahaId}
                period={period}
              />
            ) : (
              <Card className="rounded-[20px] border-slate-200/75 bg-white p-5 text-center shadow-sm">
                <Activity className="mx-auto size-6 text-slate-400" />
                <p className="mt-2 text-sm font-semibold">Riwayat transaksi belum tersedia</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Data periode sedang disiapkan atau belum dapat diverifikasi. Tampilan tidak akan menganggapnya sebagai transaksi kosong.</p>
                <Button type="button" variant="outline" className="mt-3 rounded-xl" onClick={() => void dashboard.refetch()}><RefreshCw className="mr-2 size-3.5" />Segarkan data</Button>
              </Card>
            )
          ) : null}

          {tab === "accounts" ? (
            <div className="space-y-3">
              <AccountsTab
                dashboard={dashboard}
                selectedOverview={overview}
                selectedContract={selectedContract}
                canClosePeriod={canCloseSelectedPeriod}
                canRecordOpenAdvance={canRecordOpenAdvance}
                closePending={closeMutation.isPending}
                closeError={closeMutation.error instanceof Error ? closeMutation.error.message : null}
                onFinanceChange={refreshFinanceAndHistory}
                onClosePeriod={() => closeMutation.mutate()}
              />
              {overview.principal === "investor" ? (
                <InvestorAccountTransferCard
                  dashboard={dashboard}
                  onSuccess={refreshFinanceAndHistory}
                />
              ) : null}
              <InvestorStakeholderHistoryCard
                history={stakeholderHistory.data}
                isLoading={stakeholderHistory.isLoading}
                error={stakeholderHistory.error}
                onRetry={() => void stakeholderHistory.refetch()}
              />
            </div>
          ) : null}
        </main>

        {closeMutation.isPending ? <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900 px-3 py-2 text-[9px] font-semibold text-white shadow-xl">Menutup periode…</div> : null}
        {closeMutation.error ? <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-red-600 px-3 py-2 text-[9px] font-semibold text-white shadow-xl">{closeMutation.error instanceof Error ? closeMutation.error.message : "Periode gagal ditutup."}</div> : null}
        <TransactionDetail item={selected} onClose={() => setSelected(null)} />
      </div>
    </div>
  );
}
