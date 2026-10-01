import type { CatalogTariff } from "./types";

export function formatCatalogMoney(
  amount: number | null | undefined,
  currency = "IDR",
) {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatTariffDuration(tariff: CatalogTariff) {
  return tariff.durasi_nilai + " " + tariff.durasi_unit;
}

export function isActiveCatalogTariff(tariff: CatalogTariff, now = new Date()) {
  return (
    tariff.status === "active" &&
    new Date(tariff.berlaku_mulai).getTime() <= now.getTime() &&
    (!tariff.berlaku_sampai || new Date(tariff.berlaku_sampai).getTime() > now.getTime())
  );
}

export function catalogStatusLabel(status: string) {
  return status === "active" ? "Aktif" : status === "inactive" ? "Nonaktif" : status === "draft" ? "Draf" : status;
}

export function catalogErrorMessage(error: unknown, fallback = "Perubahan Katalog gagal."): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "details", "hint"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
      if (value && typeof value === "object") {
        try {
          const nested: string = catalogErrorMessage(value, "");
          if (nested) return nested;
        } catch {
          // Ignore malformed nested error objects.
        }
      }
    }
    if (typeof record.code === "string" && record.code.trim()) return record.code;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Ignore circular/unserializable error objects.
    }
  }
  return fallback;
}

export function catalogVariantCapacity(attributes: Record<string, unknown> | null | undefined) {
  if (!attributes) return "";
  const generic = attributes.kapasitas;
  if (typeof generic === "string" || typeof generic === "number") return String(generic);
  const liters = attributes.kapasitas_liter;
  if (typeof liters === "number" && Number.isFinite(liters)) return String(liters) + " liter";
  if (typeof liters === "string" && liters.trim()) return liters.trim() + " liter";
  return "";
}

export function catalogVariantColor(attributes: Record<string, unknown> | null | undefined) {
  const value = attributes?.warna;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
