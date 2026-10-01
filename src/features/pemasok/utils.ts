const SUPPLIER_STATUS_LABELS: Record<string, string> = {
  active: "Aktif",
  inactive: "Tidak aktif",
};


export function supplierStatusLabel(status: string) {
  return SUPPLIER_STATUS_LABELS[status] ?? status;
}

export function purchaseStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Draf",
    active: "Aktif",
    completed: "Selesai",
    cancelled: "Dibatalkan",
    received: "Diterima",
    pending: "Menunggu",
  };
  return labels[status.toLowerCase()] ?? status
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function supplierStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "inactive") return "outline";
  return "secondary";
}

export function purchaseStatusVariant(): "default" | "secondary" | "destructive" | "outline" {
  return "secondary";
}

export function formatProcurementDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(date);
}

export function formatProcurementDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatPurchaseMoney(value: string | number | null | undefined, currency = "IDR") {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function sanitizeProcurementSearch(value: string) {
  return value.trim().replace(/[*,%(),]/g, " ").replace(/\s+/g, " ").slice(0, 120);
}
