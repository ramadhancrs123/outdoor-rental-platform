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
    cleaning: "Cleaning",
    repair: "Repair",
    replacement: "Replacement",
    inspection_follow_up: "Tindak lanjut pemeriksaan",
    other: "Lainnya",
    maintenance_required: "Perlu maintenance",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

export function nextMaintenanceAction(status: string) {
  if (status === "planned") return "Mulai Perawatan";
  if (status === "in_progress") return "Selesaikan Perawatan";
  if (status === "completed") return "Buka Verifikasi";
  return "Tinjau state";
}

export function normalizeMaintenanceText(value: string | null | undefined) {
  return value?.trim() || null;
}
