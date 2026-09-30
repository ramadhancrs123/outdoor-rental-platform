const REQUEST_SOURCE_LABELS: Record<string, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  phone: "Telepon",
  walk_in: "Walk-in",
  admin: "Admin",
  other: "Lainnya",
};

export function requestSourceLabel(source: string) {
  return REQUEST_SOURCE_LABELS[source] ?? source;
}

export function semanticStatusLabel(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function stockLockStatusLabel(status: string) {
  return semanticStatusLabel(status);
}

export function statusVariant(): "default" | "secondary" | "destructive" | "outline" {
  return "secondary";
}

export function formatReservationDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(date);
}

export function formatReservationDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatReservationMoney(
  value: string | number | null | undefined,
  currency = "IDR",
) {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function sanitizeReservationSearch(value: string) {
  return value.trim().replace(/[*,%(),]/g, " ").replace(/\s+/g, " ").slice(0, 120);
}
