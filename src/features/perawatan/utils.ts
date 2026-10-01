export function formatMaintenanceDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function semanticMaintenanceLabel(value: string | null | undefined) {
  if (!value) return "-";
  const labels: Record<string, string> = {
    planned: "Direncanakan",
    in_progress: "Berjalan",
    completed: "Selesai",
    cancelled: "Dibatalkan",
    cleaning: "Pembersihan",
    repair: "Perbaikan",
    replacement: "Penggantian",
    inspection_follow_up: "Tindak lanjut pemeriksaan",
    other: "Lainnya",
    maintenance_required: "Perlu Perawatan",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

export function nextMaintenanceAction(status: string) {
  if (status === "planned") return "Mulai Perawatan";
  if (status === "in_progress") return "Selesaikan Perawatan";
  if (status === "completed") return "Buka Verifikasi";
  return "Tinjau status";
}

export function normalizeMaintenanceText(value: string | null | undefined) {
  return value?.trim() || null;
}
