const STATUS_LABELS: Record<string, string> = {
  ready: "Siap disewakan",
  available: "Siap disewakan",
  rented: "Sedang disewa",
  perlu_pemeriksaan: "Perlu pemeriksaan",
  inspection_pending: "Perlu pemeriksaan",
  maintenance: "Perawatan",
  damaged: "Rusak",
  lost: "Hilang",
  inactive: "Dinonaktifkan",
};

const EVENT_LABELS: Record<string, string> = {
  UNIT_REGISTERED: "Unit didaftarkan",
  LOCATION_MOVED: "Lokasi dipindahkan",
  INSPECTION_PENDING: "Diteruskan ke pemeriksaan",
  READY: "Siap Disewakan ditetapkan",
  UNIT_READY: "Siap Disewakan ditetapkan",
  RENTAL_ASSIGNED: "Unit ditetapkan ke Penyewaan",
  RENTAL_ACTIVE: "Penyewaan aktif",
  UNIT_RETURNED: "Unit diterima kembali",
  MAINTENANCE_STARTED: "Perawatan dimulai",
  MAINTENANCE_COMPLETED: "Perawatan selesai",
};

export function inventoryStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

export function inventoryStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (["ready", "available"].includes(status)) return "default";
  if (["damaged", "lost"].includes(status)) return "destructive";
  if (status === "inactive") return "outline";
  return "secondary";
}

export function inventoryAvailabilityContextLabel(value: "all" | "ready_now" | "rental_active" | "attention") {
  if (value === "ready_now") return "Siap secara fisik";
  if (value === "rental_active") return "Sedang disewa";
  if (value === "attention") return "Perlu perhatian";
  return "Semua konteks";
}

export function inventoryEventLabel(value: string) {
  return EVENT_LABELS[value] ?? value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatInventoryDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(date);
}

export function formatInventoryDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function sanitizeInventorySearch(value: string) {
  return value.trim().replace(/[*,%(),]/g, " ").replace(/\s+/g, " ").slice(0, 120);
}
