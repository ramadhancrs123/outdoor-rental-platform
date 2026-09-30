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
  return `${tariff.durasi_nilai} ${tariff.durasi_unit}`;
}

export function isActiveCatalogTariff(tariff: CatalogTariff, now = new Date()) {
  return (
    tariff.status === "active" &&
    new Date(tariff.berlaku_mulai).getTime() <= now.getTime() &&
    (!tariff.berlaku_sampai || new Date(tariff.berlaku_sampai).getTime() > now.getTime())
  );
}

export function catalogStatusLabel(status: string) {
  return status === "active" ? "Aktif" : status === "inactive" ? "Nonaktif" : status;
}
