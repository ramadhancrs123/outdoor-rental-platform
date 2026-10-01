export function semanticReturnLabel(value: string | null | undefined) {
  if (!value) return "-";
  const labels: Record<string, string> = {
    not_due: "Belum Jatuh Tempo",
    due: "Sudah Jatuh Tempo",
    late_within_tolerance: "Masih Dalam Toleransi",
    tolerance_expired: "Toleransi Terlewati",
    returned: "Sudah Dikembalikan",
    active: "Aktif",
    return_in_progress: "Pengembalian Sedang Diproses",
    completed: "Selesai",
    cancelled: "Dibatalkan",
    pending: "Menunggu",
    inspection_pending: "Menunggu Pemeriksaan",
  };
  if (labels[value]) return labels[value];
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function returnStatusVariant(): "default" | "secondary" | "destructive" | "outline" {
  return "secondary";
}

export function formatReturnDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function sanitizeReturnSearch(value: string) {
  return value.trim().replace(/[*,%(),]/g, " ").replace(/\s+/g, " ").slice(0, 120);
}

export function deriveReturnDueState(jadwalKembali: string, toleranceDeadline: string | null, now = new Date()) {
  const schedule = new Date(jadwalKembali);
  if (Number.isNaN(schedule.getTime())) return "not_due" as const;
  const nowMs = now.getTime();
  if (nowMs < schedule.getTime()) return "not_due" as const;
  if (!toleranceDeadline) return "due" as const;
  const tolerance = new Date(toleranceDeadline);
  if (Number.isNaN(tolerance.getTime())) return "due" as const;
  if (nowMs <= tolerance.getTime()) return "late_within_tolerance" as const;
  return "tolerance_expired" as const;
}

export function formatReturnProgress(returned: number, total: number) {
  if (total <= 0) return "0 / 0";
  return `${returned} / ${total}`;
}
