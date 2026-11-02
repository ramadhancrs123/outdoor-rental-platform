import { describe, expect, it } from "vitest";

import {
  calculateRentalLineSubtotal,
  calculateTariffPeriods,
  catalogStatusLabel,
  formatCatalogMoney,
  formatTariffDuration,
  formatTariffPeriods,
  isActiveCatalogTariff,
  resolvePackagePrice,
} from "@/features/katalog";
import type { CatalogTariff } from "@/features/katalog";

describe("katalog utilities", () => {
  it("uses Indonesian currency formatting without inventing decimals", () => {
    expect(formatCatalogMoney(150000).replace(/\s/g, "")).toBe("Rp150.000");
  });

  it("maps catalog lifecycle labels to admin vocabulary", () => {
    expect(catalogStatusLabel("active")).toBe("Aktif");
    expect(catalogStatusLabel("inactive")).toBe("Nonaktif");
  });

  it("formats tariff duration from the catalog contract", () => {
    const tariff: CatalogTariff = {
      tarif_sewa_id: "tariff-1",
      usaha_id: "usaha-1",
      barang_id: "barang-1",
      varian_barang_id: null,
      paket_sewa_id: null,
      nama: "Harian",
      durasi_unit: "hari",
      durasi_nilai: 2,
      nominal: 300000,
      currency_code: "IDR",
      berlaku_mulai: "2026-09-01T00:00:00Z",
      berlaku_sampai: null,
      status: "active",
      updated_at: "2026-09-26T12:00:00Z",
    };

    expect(formatTariffDuration(tariff)).toBe("2 hari");
  });
});


describe("active tariff effective period", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  const base: CatalogTariff = {
    tarif_sewa_id: "tariff-period",
    usaha_id: "usaha-1",
    barang_id: "barang-1",
    varian_barang_id: null,
    paket_sewa_id: null,
    nama: "Harian",
    durasi_unit: "hari",
    durasi_nilai: 1,
    nominal: 100000,
    currency_code: "IDR",
    berlaku_mulai: "2026-09-01T00:00:00Z",
    berlaku_sampai: null,
    status: "active",
    updated_at: "2026-09-26T12:00:00Z",
  };

  it("presents an active tariff that has started and has not expired", () => {
    expect(isActiveCatalogTariff({ ...base, berlaku_sampai: "2026-09-30T00:00:00Z" }, now)).toBe(true);
  });

  it("does not present an active tariff that has already expired", () => {
    expect(isActiveCatalogTariff({ ...base, berlaku_sampai: "2026-09-25T00:00:00Z" }, now)).toBe(false);
  });

  it("keeps an active tariff with no end date valid after its start", () => {
    expect(isActiveCatalogTariff({ ...base, berlaku_sampai: null }, now)).toBe(true);
  });
});

describe("package promotional price resolution", () => {
  const tariff = {
    tarif_sewa_id: "package-tariff-1",
    usaha_id: "usaha-1",
    barang_id: null,
    varian_barang_id: null,
    paket_sewa_id: "package-1",
    nama: "Harian",
    durasi_unit: "hari",
    durasi_nilai: 1,
    nominal: 80000,
    currency_code: "IDR",
    berlaku_mulai: "2026-09-01T00:00:00Z",
    berlaku_sampai: null,
    status: "active",
    updated_at: "2026-09-26T12:00:00Z",
  } satisfies CatalogTariff;

  const promo = {
    promosi_paket_id: "promo-1",
    usaha_id: "usaha-1",
    paket_sewa_id: "package-1",
    tarif_sewa_id: "package-tariff-1",
    harga_normal: 80000,
    harga_promo: 65000,
    status: "active",
    started_at: "2026-09-26T10:00:00Z",
    ended_at: null,
    updated_at: "2026-09-26T11:00:00Z",
  };

  it("uses the promo as the effective price while preserving the regular tariff", () => {
    expect(resolvePackagePrice(tariff, promo)).toEqual({
      normalPrice: 80000,
      effectivePrice: 65000,
      isPromo: true,
      promo,
    });
  });

  it("keeps the regular tariff when no active promo exists", () => {
    expect(resolvePackagePrice(tariff, null)).toEqual({
      normalPrice: 80000,
      effectivePrice: 80000,
      isPromo: false,
      promo: null,
    });
  });

  it("ignores a promo belonging to another tariff", () => {
    expect(resolvePackagePrice(tariff, { ...promo, tarif_sewa_id: "other-tariff" })).toMatchObject({
      normalPrice: 80000,
      effectivePrice: 80000,
      isPromo: false,
      promo: null,
    });
  });

  it("ignores an ended promo or a promo that is not lower than normal price", () => {
    expect(resolvePackagePrice(tariff, { ...promo, status: "ended", ended_at: "2026-09-27T00:00:00Z" })).toMatchObject({
      effectivePrice: 80000,
      isPromo: false,
    });
    expect(resolvePackagePrice(tariff, { ...promo, harga_promo: 80000 })).toMatchObject({
      effectivePrice: 80000,
      isPromo: false,
    });
  });
});

describe("rental tariff period pricing", () => {
  const dailyTariff: Pick<CatalogTariff, "durasi_unit" | "durasi_nilai"> = {
    durasi_unit: "hari",
    durasi_nilai: 1,
  };

  it("charges four daily periods for a four-day elapsed rental", () => {
    const periods = calculateTariffPeriods(
      "2026-10-01T09:00:00+07:00",
      "2026-10-05T09:00:00+07:00",
      dailyTariff,
    );

    expect(periods).toBe(4);
    expect(calculateRentalLineSubtotal(1, 30000, periods)).toBe(120000);
    expect(formatTariffPeriods(periods, dailyTariff)).toBe("4 hari");
  });

  it("rounds up a partial tariff period instead of charging zero", () => {
    const periods = calculateTariffPeriods(
      "2026-10-01T09:00:00+07:00",
      "2026-10-02T10:00:00+07:00",
      dailyTariff,
    );

    expect(periods).toBe(2);
    expect(calculateRentalLineSubtotal(2, 30000, periods)).toBe(120000);
  });
});
