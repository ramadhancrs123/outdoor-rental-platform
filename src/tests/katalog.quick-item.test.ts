import { describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
  },
}));

import {
  listQuickItemLocations,
  onboardQuickItem,
  quickItemLocationSelection,
} from "@/features/katalog/quick-item";

describe("Quick Item frontend contract", () => {
  test("sends only business-level onboarding payload and idempotency", async () => {
    rpcMock.mockResolvedValue({
      data: {
        state: "committed",
        usaha_id: "usaha-1",
        barang_id: "barang-1",
        barang_nama: "Tenda 4P",
        deskripsi: null,
        slug: "tenda-4p",
        kategori_barang_id: "category-1",
        kategori_dibuat: false,
        lokasi_id: "location-1",
        varian_mode: false,
        variant_count: 0,
        unit_count: 2,
        tariff_count: 1,
        min_price: 65000,
        max_price: 65000,
        currency_code: "IDR",
        durasi_unit: "hari",
        durasi_nilai: 1,
        variants: [],
        tariffs: [],
        units: [],
        readiness: "ready",
        source: "quick_item_onboarding",
        existing_stock: true,
      },
      error: null,
    });

    await expect(onboardQuickItem("usaha-1", {
      kategoriBarangId: "category-1",
      namaBarang: "  Tenda 4P ",
      deskripsi: "Tenda dome 4 orang.",
      hargaSewa: { nominal: 65000, durasiUnit: "hari", durasiNilai: 1, currencyCode: "IDR" },
      jumlah: 2,
      lokasiId: "location-1",
      varianMode: false,
    }, {
      idempotencyKey: "quick-item-test",
      requestId: "request-1",
    })).resolves.toMatchObject({
      barang_id: "barang-1",
      unit_count: 2,
      readiness: "ready",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_quick_item_onboarding", {
      p_usaha_id: "usaha-1",
      p_payload: {
        kategori_barang_id: "category-1",
        kategori_nama: null,
        nama_barang: "Tenda 4P",
        deskripsi: "Tenda dome 4 orang.",
        harga_sewa: { nominal: 65000, durasi_unit: "hari", durasi_nilai: 1, currency_code: "IDR" },
        jumlah: 2,
        lokasi_id: "location-1",
        varian_mode: false,
        variant_dimensions: [],
        variants: [],
        advanced_mode: false,
        unit_details: [],
      },
      p_idempotency_key: "quick-item-test",
      p_request_id: "request-1",
    });
  });

  test("reconciles unknown transport result instead of blind retry", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
      .mockResolvedValueOnce({ data: { state: "committed", response: { barang_id: "barang-2", readiness: "ready" } }, error: null });

    await expect(onboardQuickItem("usaha-1", {
      kategoriBarangId: "category-1",
      namaBarang: "Carrier 60L",
      hargaSewa: { nominal: 70000, durasiUnit: "hari", durasiNilai: 1, currencyCode: "IDR" },
      jumlah: 1,
      lokasiId: "location-1",
      varianMode: false,
    }, {
      idempotencyKey: "quick-item-unknown",
      requestId: "request-2",
    })).resolves.toMatchObject({ barang_id: "barang-2" });

    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_catalog_mutation", {
      p_usaha_id: "usaha-1",
      p_command_name: "quick_item_onboarding",
      p_idempotency_key: "quick-item-unknown",
    });
  });

  test("variant onboarding keeps tariff ownership on each variant", async () => {
    rpcMock.mockResolvedValue({
      data: {
        state: "committed",
        usaha_id: "usaha-1",
        barang_id: "barang-3",
        barang_nama: "Tenda Consina",
        deskripsi: "Tenda dome untuk outdoor.",
        slug: "tenda-consina",
        kategori_barang_id: "category-1",
        kategori_dibuat: false,
        lokasi_id: "location-1",
        varian_mode: true,
        variant_count: 2,
        unit_count: 6,
        tariff_count: 2,
        min_price: 65000,
        max_price: 75000,
        currency_code: "IDR",
        durasi_unit: "hari",
        durasi_nilai: 1,
        variants: [],
        tariffs: [],
        units: [],
        readiness: "ready",
        source: "quick_item_onboarding",
        existing_stock: true,
      },
      error: null,
    });

    await onboardQuickItem("usaha-1", {
      kategoriBarangId: "category-1",
      namaBarang: "Tenda Consina",
      deskripsi: "Tenda dome untuk outdoor.",
      hargaSewa: { nominal: null, durasiUnit: "hari", durasiNilai: 1, currencyCode: "IDR" },
      jumlah: null,
      lokasiId: "location-1",
      varianMode: true,
      variantDimensions: ["warna", "kapasitas"],
      variants: [
        { attributes: { warna: "Hitam", kapasitas: "6 orang" }, quantity: 2, nominal: 75000 },
        { attributes: { warna: "Hitam", kapasitas: "4 orang" }, quantity: 4, nominal: 65000 },
      ],
      advancedMode: true,
      unitDetails: [
        { serialNumber: "SN-001", tanggalDiperoleh: "2026-10-01", catatanInternal: "Unit 1" },
        { serialNumber: "SN-002", tanggalDiperoleh: "2026-10-01", catatanInternal: "Unit 2" },
        { serialNumber: "SN-003", tanggalDiperoleh: "2026-10-01", catatanInternal: "Unit 3" },
        { serialNumber: "SN-004", tanggalDiperoleh: "2026-10-01", catatanInternal: "Unit 4" },
        { serialNumber: "SN-005", tanggalDiperoleh: "2026-10-01", catatanInternal: "Unit 5" },
        { serialNumber: "SN-006", tanggalDiperoleh: "2026-10-01", catatanInternal: "Unit 6" },
      ],
    }, {
      idempotencyKey: "quick-item-variant",
      requestId: "request-3",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_quick_item_onboarding", expect.objectContaining({
      p_payload: expect.objectContaining({
        harga_sewa: { nominal: null, durasi_unit: "hari", durasi_nilai: 1, currency_code: "IDR" },
        jumlah: null,
        deskripsi: "Tenda dome untuk outdoor.",
        varian_mode: true,
        variants: [
          { attributes: { warna: "Hitam", kapasitas: "6 orang" }, quantity: 2, nominal: 75000 },
          { attributes: { warna: "Hitam", kapasitas: "4 orang" }, quantity: 4, nominal: 65000 },
        ],
        advanced_mode: true,
        unit_details: [
          { serialNumber: "SN-001", tanggalDiperoleh: "2026-10-01", catatanInternal: "Unit 1" },
          { serialNumber: "SN-002", tanggalDiperoleh: "2026-10-01", catatanInternal: "Unit 2" },
          { serialNumber: "SN-003", tanggalDiperoleh: "2026-10-01", catatanInternal: "Unit 3" },
          { serialNumber: "SN-004", tanggalDiperoleh: "2026-10-01", catatanInternal: "Unit 4" },
          { serialNumber: "SN-005", tanggalDiperoleh: "2026-10-01", catatanInternal: "Unit 5" },
          { serialNumber: "SN-006", tanggalDiperoleh: "2026-10-01", catatanInternal: "Unit 6" },
        ],
      }),
    }));
  });

  test("uses automatic location when exactly one active location exists", () => {
    const result = quickItemLocationSelection([
      {
        lokasi_id: "location-1",
        usaha_id: "usaha-1",
        nama: "Kantor",
        tipe: "gudang",
        alamat: null,
        keterangan: null,
        status: "active",
        created_at: "",
        updated_at: "",
      },
    ]);

    expect(result).toEqual({
      selectedLocationId: "location-1",
      selectionRequired: false,
    });
  });

  test("requires explicit choice when multiple active locations exist", () => {
    const locations = [
      { lokasi_id: "location-1", usaha_id: "usaha-1", nama: "A", tipe: "gudang", alamat: null, keterangan: null, status: "active", created_at: "", updated_at: "" },
      { lokasi_id: "location-2", usaha_id: "usaha-1", nama: "B", tipe: "gudang", alamat: null, keterangan: null, status: "active", created_at: "", updated_at: "" },
    ];

    expect(quickItemLocationSelection(locations)).toEqual({
      selectedLocationId: null,
      selectionRequired: true,
    });
  });

  test("lists only active locations for the Quick Item read model", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ lokasi_id: "location-1", status: "active" }],
      error: null,
    });
    const eqStatus = vi.fn(() => ({ order }));
    const eqUsaha = vi.fn(() => ({ eq: eqStatus }));
    fromMock.mockReturnValue({ select: vi.fn(() => ({ eq: eqUsaha })) });

    await expect(listQuickItemLocations("usaha-1")).resolves.toHaveLength(1);
    expect(fromMock).toHaveBeenCalledWith("lokasi");
  });
});
