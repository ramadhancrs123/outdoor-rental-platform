import { describe, expect, test } from "vitest";
import type { InventoryVariant } from "@/features/inventaris/types";
import {
  EMPTY_INVENTORY_VARIANT_DRAFT,
  findInventoryVariantNameCollision,
  findMatchingInventoryVariant,
  inventoryVariantDraftAttributes,
  inventoryVariantDraftName,
  inventoryVariantHasIdentity,
  inventoryVariantIdentityKey,
  type InventoryVariantDraft,
} from "@/features/inventaris/variant-draft";

const draft = (overrides: Partial<InventoryVariantDraft> = {}): InventoryVariantDraft => ({
  ...EMPTY_INVENTORY_VARIANT_DRAFT,
  ...overrides,
});

const variant = (
  overrides: Partial<InventoryVariant> & Pick<InventoryVariant, "varian_barang_id" | "nama" | "atribut_pembeda">,
): InventoryVariant => {
  const { varian_barang_id, nama, atribut_pembeda, ...rest } = overrides;
  return {
    varian_barang_id,
    barang_id: "barang-1",
    nama,
    kode_internal: null,
    deskripsi: null,
    atribut_pembeda,
    status: "active",
    ...rest,
  };
};

describe("inventory variant draft", () => {
  test("builds a catalog variant name and only persists non-empty attributes", () => {
    const value = draft({ warna: " Hitam ", kapasitas: " 4 orang ", catatan: "Unit lama" });

    expect(inventoryVariantDraftName(value)).toBe("Warna Hitam · Kapasitas/Ukuran 4 orang");
    expect(inventoryVariantDraftAttributes(value)).toEqual({
      warna: "Hitam",
      kapasitas: "4 orang",
      catatan: "Unit lama",
    });
    expect(inventoryVariantHasIdentity(value)).toBe(true);
    expect(inventoryVariantHasIdentity(draft({ catatan: "Catatan saja" }))).toBe(false);
  });

  test("matches an existing variant by normalized identity dimensions, not note", () => {
    const existing = variant({
      varian_barang_id: "variant-1",
      nama: "Tenda hitam 4P",
      atribut_pembeda: { warna: "Hitam", ukuran: "4 ORANG", catatan: "Catatan lama" },
    });

    expect(findMatchingInventoryVariant([existing], draft({
      warna: " hitam ",
      kapasitas: "4 orang",
      catatan: "Catatan baru",
    }))).toEqual(existing);
    expect(findMatchingInventoryVariant([existing], draft({ warna: "Hitam", kapasitas: "6 orang" }))).toBeNull();
  });

  test("normalizes legacy capacity aliases and rejects empty identity keys", () => {
    expect(inventoryVariantIdentityKey({ warna: "  HITAM  ", kapasitas_liter: "40 L" }))
      .toBe(inventoryVariantIdentityKey({ warna: "hitam", kapasitas: "40 l" }));
    expect(inventoryVariantIdentityKey({ catatan: "warna hitam" })).toBeNull();
  });

  test("detects a generated name already used by a different identity", () => {
    const existing = variant({
      varian_barang_id: "variant-1",
      nama: "Warna Hitam · Kapasitas/Ukuran 4 orang",
      atribut_pembeda: { warna: "Hitam", kapasitas: "6 orang" },
    });

    expect(findInventoryVariantNameCollision([existing], draft({ warna: " hitam ", kapasitas: "4 ORANG" })))
      .toEqual(existing);
  });
});
