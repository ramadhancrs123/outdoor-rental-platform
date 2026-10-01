export function semanticRentalLabel(value: string | null | undefined) {
  if (!value) return "-";
  const labels: Record<string, string> = {
    draft: "Draf",
    active: "Aktif",
    confirmed: "Dikonfirmasi",
    ready_for_pickup: "Siap Diambil",
    return_in_progress: "Pengembalian Sedang Diproses",
    completed: "Selesai",
    cancelled: "Dibatalkan",
    returned: "Sudah Dikembalikan",
  };
  if (labels[value]) return labels[value];
  return value.toLowerCase().split("_").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function rentalStatusVariant(): "default" | "secondary" | "destructive" | "outline" {
  return "secondary";
}

export function formatRentalDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatRentalMoney(value: string | number | null | undefined, currency = "IDR") {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: 2 }).format(numeric);
}

export function sanitizeRentalSearch(value: string) {
  return value.trim().replace(/[*,%(),]/g, " ").replace(/\s+/g, " ").slice(0, 120);
}
