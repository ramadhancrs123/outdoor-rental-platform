import type { FinancePeriodPreset, FinancePeriodSelection } from "./types";

export function semanticFinanceLabel(value: string | null | undefined) {
  if (!value) return "-";
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function financeStatusVariant(): "default" | "secondary" | "destructive" | "outline" {
  return "secondary";
}

export function formatFinanceDate(value: string | null | undefined, timezone?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", ...(timezone ? { timeZone: timezone } : {}) }).format(date);
}

export function formatFinanceDateTime(value: string | null | undefined, timezone?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);
}

export function formatFinanceMoney(value: string | number | null | undefined, currency = "IDR") {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function sanitizeFinanceSearch(value: string) {
  return value.trim().replace(/[*,%(),]/g, " ").replace(/\s+/g, " ").slice(0, 120);
}

function businessDateParts(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateOnly: string, days: number) {
  const date = new Date(dateOnly + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

function startOfBusinessWeek(dateOnly: string) {
  const date = new Date(dateOnly + "T00:00:00Z");
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + mondayOffset);
  return toDateOnly(date);
}

export function getFinancePeriodSelection(
  timezone: string,
  preset: FinancePeriodPreset,
  customStartDate?: string,
  customEndDateInclusive?: string,
): FinancePeriodSelection {
  const { year, month, day } = businessDateParts(timezone);
  const today = [year.toString().padStart(4, "0"), month.toString().padStart(2, "0"), day.toString().padStart(2, "0")].join("-");

  if (preset === "today") {
    return { preset, startDate: today, endDateExclusive: addDays(today, 1) };
  }

  if (preset === "week") {
    const start = startOfBusinessWeek(today);
    return { preset, startDate: start, endDateExclusive: addDays(today, 1) };
  }

  if (preset === "custom") {
    const start = customStartDate || today;
    const inclusiveEnd = customEndDateInclusive || start;
    return { preset, startDate: start, endDateExclusive: addDays(inclusiveEnd, 1) };
  }

  const monthStart = [year.toString().padStart(4, "0"), month.toString().padStart(2, "0"), "01"].join("-");
  const nextMonth = month === 12
    ? [String(year + 1).padStart(4, "0"), "01", "01"].join("-")
    : [String(year).padStart(4, "0"), String(month + 1).padStart(2, "0"), "01"].join("-");
  return { preset: "month", startDate: monthStart, endDateExclusive: nextMonth };
}

export function formatFinancePeriodLabel(startDate: string, endDateExclusive: string, timezone: string) {
  const endInclusive = addDays(endDateExclusive, -1);
  return formatFinanceDate(startDate + "T00:00:00Z", timezone) + " – " + formatFinanceDate(endInclusive + "T00:00:00Z", timezone);
}

export function formatFinanceTimezone(timezone: string) {
  try {
    const label = new Intl.DateTimeFormat("id-ID", { timeZone: timezone, timeZoneName: "short" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    return label ? timezone + " (" + label + ")" : timezone;
  } catch {
    return timezone;
  }
}