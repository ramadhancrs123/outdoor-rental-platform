import { describe, expect, it } from "vitest";

import { catalogStatusLabel, formatCatalogMoney, formatTariffDuration, isActiveCatalogTariff } from "@/features/katalog";
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
