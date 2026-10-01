import type { CatalogTariff } from "./types";

const DURATION_UNIT_MS: Record<string, number> = {
  jam: 60 * 60 * 1000,
  hari: 24 * 60 * 60 * 1000,
  minggu: 7 * 24 * 60 * 60 * 1000,
};

function getTariffPeriodMs(tariff: Pick<CatalogTariff, "durasi_unit" | "durasi_nilai">) {
  const unitMs = DURATION_UNIT_MS[tariff.durasi_unit.trim().toLowerCase()];
  if (!unitMs || !Number.isFinite(tariff.durasi_nilai) || tariff.durasi_nilai <= 0) {
    return null;
  }
  return unitMs * tariff.durasi_nilai;
}

export function calculateTariffPeriods(
  startAt: string,
  endAt: string,
  tariff: Pick<CatalogTariff, "durasi_unit" | "durasi_nilai">,
) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;

  const periodMs = getTariffPeriodMs(tariff);
  if (!periodMs) return 0;

  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / periodMs));
}

export function calculateRentalLineSubtotal(
  quantity: number,
  unitPrice: number,
  periods: number,
) {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || !Number.isFinite(periods)) return 0;
  return Math.round(quantity * unitPrice * periods * 100) / 100;
}

export function formatTariffPeriods(periods: number, tariff: Pick<CatalogTariff, "durasi_unit" | "durasi_nilai">) {
  const unit = tariff.durasi_unit.trim();
  const totalUnits = periods * tariff.durasi_nilai;
  return totalUnits + " " + unit;
}
