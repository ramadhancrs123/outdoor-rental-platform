import type { InspectionFindingInput } from "./types";
export function semanticInspectionLabel(value: string | null | undefined) {
  if (!value) return "-";
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatInspectionDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function normalizeInspectionFindings(findings: InspectionFindingInput[]) {
  return findings
    .map((finding) => ({
      ...finding,
      deskripsi: finding.deskripsi.trim(),
      tingkat: finding.tingkat?.trim() || null,
      status_tindak_lanjut: finding.status_tindak_lanjut?.trim() || "open",
      nominal_potensi_biaya:
        finding.nominal_potensi_biaya === null || finding.nominal_potensi_biaya === undefined
          ? null
          : Number(finding.nominal_potensi_biaya),
      currency_code: finding.currency_code?.trim() || "IDR",
    }))
    .filter((finding) => finding.jenis_temuan && finding.deskripsi);
}

export function deriveInspectionState(statusPemeriksaan: string, latestResult: string | null) {
  if (latestResult && latestResult !== "pending") return "completed" as const;
  if (statusPemeriksaan === "in_progress") return "in_progress" as const;
  return "waiting" as const;
}

export function nextInspectionAction(decision: string | null) {
  switch (decision) {
    case "maintenance_required":
      return "Diteruskan ke Perawatan";
    case "cleaning_required":
      return "Diteruskan ke tindakan cleaning";
    case "unavailable":
      return "Unit tetap tidak siap sampai state berikutnya ditangani";
    case "follow_up_required":
      return "Perlu tindak lanjut operasional";
    case "ready_review":
    case "readiness_review":
    case "no_action":
      return "Diteruskan ke readiness review Inventaris";
    default:
      return "Tinjau hasil pemeriksaan";
  }
}
