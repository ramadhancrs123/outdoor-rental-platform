import type { InventoryVariant } from "./types";

export type InventoryVariantDraft = {
  warna: string;
  kapasitas: string;
  seri: string;
  catatan: string;
  kodeInternal: string;
  deskripsi: string;
};

export const EMPTY_INVENTORY_VARIANT_DRAFT: InventoryVariantDraft = {
  warna: "",
  kapasitas: "",
  seri: "",
  catatan: "",
  kodeInternal: "",
  deskripsi: "",
};

const normalize = (value: unknown) =>
  (typeof value === "string" || typeof value === "number" ? String(value) : "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("id-ID");

function dimensionValue(attributes: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!attributes) return "";
  for (const key of keys) {
    const value = normalize(attributes[key]);
    if (value) return value;
  }
  return "";
}

export function inventoryVariantDraftAttributes(draft: InventoryVariantDraft): Record<string, unknown> {
  return {
    ...(draft.warna.trim() ? { warna: draft.warna.trim() } : {}),
    ...(draft.kapasitas.trim() ? { kapasitas: draft.kapasitas.trim() } : {}),
    ...(draft.seri.trim() ? { seri: draft.seri.trim() } : {}),
    ...(draft.catatan.trim() ? { catatan: draft.catatan.trim() } : {}),
  };
}

export function inventoryVariantDraftName(draft: InventoryVariantDraft) {
  return [
    draft.warna.trim() ? "Warna " + draft.warna.trim() : "",
    draft.kapasitas.trim() ? "Kapasitas/Ukuran " + draft.kapasitas.trim() : "",
    draft.seri.trim() ? "Seri " + draft.seri.trim() : "",
  ].filter(Boolean).join(" · ");
}

export function inventoryVariantHasIdentity(draft: InventoryVariantDraft) {
  return Boolean(draft.warna.trim() || draft.kapasitas.trim() || draft.seri.trim());
}

export function inventoryVariantIdentityKey(attributes: Record<string, unknown> | null | undefined) {
  const parts = [
    dimensionValue(attributes, ["warna"]),
    dimensionValue(attributes, ["kapasitas", "ukuran", "kapasitas_liter"]),
    dimensionValue(attributes, ["seri"]),
  ];
  return parts.every((part) => !part) ? null : JSON.stringify(parts);
}

export function findMatchingInventoryVariant(variants: InventoryVariant[], draft: InventoryVariantDraft) {
  const wanted = inventoryVariantIdentityKey(inventoryVariantDraftAttributes(draft));
  if (!wanted) return null;
  return variants.find((variant) => inventoryVariantIdentityKey(variant.atribut_pembeda) === wanted) ?? null;
}

export function findInventoryVariantNameCollision(variants: InventoryVariant[], draft: InventoryVariantDraft) {
  const wanted = normalize(inventoryVariantDraftName(draft));
  if (!wanted) return null;
  return variants.find((variant) => normalize(variant.nama) === wanted) ?? null;
}
