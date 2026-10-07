import { describe, expect, test } from "vitest";
import {
  calculateDraftItemProductQuantity,
  calculateRentalPeriodPreview,
} from "@/features/penyewaan/utils";

describe("Rental period preview", () => {
  test("rounds 24 hours plus 2 minutes to 2 daily tariff periods", () => {
    const result = calculateRentalPeriodPreview(
      "2026-10-03T07:14:00",
      "2026-10-04T07:16:00",
      10,
    );

    expect(result).toMatchObject({
      elapsedHours: 24.03,
      dailyPeriods: 2,
      isOver24Hours: true,
      toleranceHours: 10,
    });
  });

  test("keeps exactly 24 hours at one daily period and adds tolerance after scheduled return", () => {
    const result = calculateRentalPeriodPreview(
      "2026-10-03T07:14:00",
      "2026-10-04T07:14:00",
      10,
    );

    expect(result).toMatchObject({
      elapsedHours: 24,
      elapsedDays: 1,
      dailyPeriods: 1,
      isOver24Hours: false,
      toleranceHours: 10,
    });
    expect(new Date(result!.toleranceDeadline).getTime() - new Date(result!.endAt).getTime())
      .toBe(10 * 60 * 60 * 1000);
  });

  test("counts barang utama and all variants against the same product stock pool", () => {
    const lines = [
      {
        key: "item:barang-4p:base",
        kind: "item" as const,
        input: { barang_id: "barang-4p", varian_barang_id: null, jumlah: 2 },
      },
      {
        key: "item:barang-4p:cream",
        kind: "item" as const,
        input: { barang_id: "barang-4p", varian_barang_id: "variant-cream", jumlah: 1 },
      },
    ];

    expect(calculateDraftItemProductQuantity(lines, "barang-4p")).toBe(3);
    expect(
      calculateDraftItemProductQuantity(lines, "barang-4p", "item:barang-4p:cream"),
    ).toBe(2);
  });

  test("replacing the current variant line does not double count its previous quantity", () => {
    const lines = [
      {
        key: "item:barang-4p:base",
        kind: "item" as const,
        input: { barang_id: "barang-4p", varian_barang_id: null, jumlah: 1 },
      },
      {
        key: "item:barang-4p:cream",
        kind: "item" as const,
        input: { barang_id: "barang-4p", varian_barang_id: "variant-cream", jumlah: 1 },
      },
    ];

    expect(
      calculateDraftItemProductQuantity(lines, "barang-4p", "item:barang-4p:cream") + 1,
    ).toBe(2);
  });

  test("mixing base, cream, and black variants cannot exceed the shared parent stock pool", () => {
    const lines = [
      {
        key: "item:barang-4p:base",
        kind: "item" as const,
        input: { barang_id: "barang-4p", varian_barang_id: null, jumlah: 1 },
      },
      {
        key: "item:barang-4p:cream",
        kind: "item" as const,
        input: { barang_id: "barang-4p", varian_barang_id: "variant-cream", jumlah: 1 },
      },
    ];

    expect(calculateDraftItemProductQuantity(lines, "barang-4p") + 1).toBe(3);
  });
});
