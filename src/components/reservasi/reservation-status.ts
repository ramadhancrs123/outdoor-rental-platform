export type ReservationStatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export function reservationStatusPresentation(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "confirmed") return { label: "Confirmed", tone: "success" as ReservationStatusTone, iconName: "check" as const };
  if (normalized === "cancelled") return { label: "Cancelled", tone: "danger" as ReservationStatusTone, iconName: "x" as const };
  if (normalized === "pending") return { label: "Pending", tone: "warning" as ReservationStatusTone, iconName: "clock" as const };
  if (normalized === "expired") return { label: "Expired", tone: "warning" as ReservationStatusTone, iconName: "alert" as const };
  if (normalized === "converted" || normalized === "fulfilled") return { label: "Fulfilled", tone: "info" as ReservationStatusTone, iconName: "check" as const };
  return { label: "Draft", tone: "neutral" as ReservationStatusTone, iconName: "draft" as const };
}

export function stockLockPresentation(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "locked") return { label: "Kapasitas Terkunci", tone: "success" as ReservationStatusTone, iconName: "lock" as const };
  if (normalized === "pending") return { label: "Menunggu Lock", tone: "warning" as ReservationStatusTone, iconName: "clock" as const };
  if (normalized === "released") return { label: "Kapasitas Dilepas", tone: "neutral" as ReservationStatusTone, iconName: "unlock" as const };
  return { label: "Belum Terkunci", tone: "neutral" as ReservationStatusTone, iconName: "unlock" as const };
}

export function reservationToneClasses(tone: ReservationStatusTone) {
  return {
    neutral: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-300",
    warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-300",
    danger: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/35 dark:text-rose-300",
    info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/35 dark:text-sky-300",
  }[tone];
}
