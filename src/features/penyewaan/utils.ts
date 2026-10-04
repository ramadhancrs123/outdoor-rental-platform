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


export function calculateDraftItemProductQuantity(
  lines: Array<{
    key: string;
    kind: "item" | "package";
    input: { barang_id?: string | null; jumlah?: number | string | null };
  }>,
  barangId: string,
  excludeLineKey?: string,
) {
  return lines.reduce((total, line) => {
    if (line.key === excludeLineKey || line.kind !== "item" || line.input.barang_id !== barangId) return total;
    const quantity = Number(line.input.jumlah ?? 0);
    return total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
}

export function calculateRentalPeriodPreview(
  startAt: string,
  endAt: string,
  toleranceHours: number,
) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;

  const elapsedSeconds = Math.max(0, (end.getTime() - start.getTime()) / 1000);
  const dailyPeriods = Math.max(1, Math.ceil(elapsedSeconds / 86400));
  const toleranceDeadline = new Date(end.getTime() + Math.max(0, toleranceHours) * 60 * 60 * 1000);

  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    elapsedSeconds,
    elapsedHours: Math.round((elapsedSeconds / 3600) * 100) / 100,
    elapsedDays: Math.round((elapsedSeconds / 86400) * 100) / 100,
    dailyPeriods,
    isOver24Hours: elapsedSeconds > 86400,
    excessOver24hSeconds: Math.max(0, elapsedSeconds - 86400),
    toleranceHours,
    toleranceDeadline: toleranceDeadline.toISOString(),
  };
}
