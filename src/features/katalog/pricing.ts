import type { CatalogPackagePromo, CatalogTariff } from "./types";

export type PackagePriceResolution = {
  normalPrice: number | null;
  effectivePrice: number | null;
  isPromo: boolean;
  promo: CatalogPackagePromo | null;
};

export function resolvePackagePrice(
  tariff: Pick<CatalogTariff, "tarif_sewa_id" | "nominal"> | null | undefined,
  promo: CatalogPackagePromo | null | undefined,
): PackagePriceResolution {
  if (!tariff) {
    return { normalPrice: null, effectivePrice: null, isPromo: false, promo: null };
  }

  const normalPrice = Number(tariff.nominal);
  const isPromo = Boolean(
    promo &&
    promo.status === "active" &&
    promo.ended_at === null &&
    promo.tarif_sewa_id === tariff.tarif_sewa_id &&
    Number.isFinite(Number(promo.harga_promo)) &&
    Number(promo.harga_promo) >= 0 &&
    Number(promo.harga_promo) < normalPrice,
  );

  return {
    normalPrice,
    effectivePrice: isPromo ? Number(promo!.harga_promo) : normalPrice,
    isPromo,
    promo: isPromo ? promo! : null,
  };
}

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
