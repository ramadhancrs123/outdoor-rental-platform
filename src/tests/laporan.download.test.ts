import { afterEach, describe, expect, test, vi } from "vitest";
import { downloadExcelBlob } from "@/features/laporan/download";
import { downloadPdfBytes } from "@/features/qr-operasional/download";

const originalAndroidInterface = Object.getOwnPropertyDescriptor(window, "AndroidInterface");
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAndroidInterface) Object.defineProperty(window, "AndroidInterface", originalAndroidInterface);
  else Reflect.deleteProperty(window, "AndroidInterface");
  if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("Excel file download", () => {
  test("uses the browser download when native bridge is not present", async () => {
    const createObjectURL = vi.fn(() => "blob:test-xlsx");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await downloadExcelBlob(
      new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x74, 0x65, 0x73, 0x74])], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "laporan-keuangan-test.xlsx",
    );

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  test("sends a valid base64 XLSX to the Android Downloads bridge", async () => {
    const saveXlsxFromBase64 = vi.fn((base64Payload: string, fileName: string) => Boolean(base64Payload && fileName));
    Object.defineProperty(window, "AndroidInterface", {
      configurable: true,
      value: { saveXlsxFromBase64 },
    });

    await downloadExcelBlob(
      new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x74, 0x65, 0x73, 0x74])], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "laporan-keuangan-test.xlsx",
    );

    expect(saveXlsxFromBase64).toHaveBeenCalledTimes(1);
    expect(saveXlsxFromBase64.mock.calls[0]?.[1]).toBe("laporan-keuangan-test.xlsx");
    expect(saveXlsxFromBase64.mock.calls[0]?.[0]).toMatch(/^UEsDB/);
  });

  test("does not silently fall back if Android cannot save the workbook", async () => {
    Object.defineProperty(window, "AndroidInterface", {
      configurable: true,
      value: { saveXlsxFromBase64: vi.fn(() => false) },
    });

    await expect(downloadExcelBlob(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x74, 0x65, 0x73, 0x74])]), "laporan.xlsx"))
      .rejects.toThrow(/Android tidak dapat menyimpan Excel/);
  });

  test("sends PDF bytes to the same native Downloads bridge used by the thermal receipt", async () => {
    const savePdfFromBase64 = vi.fn((base64Payload: string, fileName: string) => Boolean(base64Payload && fileName));
    Object.defineProperty(window, "AndroidInterface", {
      configurable: true,
      value: { savePdfFromBase64 },
    });

    await downloadPdfBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]), "laporan-penyewaan-test.pdf");

    expect(savePdfFromBase64).toHaveBeenCalledTimes(1);
    expect(savePdfFromBase64.mock.calls[0]?.[1]).toBe("laporan-penyewaan-test.pdf");
    expect(savePdfFromBase64.mock.calls[0]?.[0]).toMatch(/^JVBERi0/);
  });

  test("reports a native PDF save failure to the caller", async () => {
    Object.defineProperty(window, "AndroidInterface", {
      configurable: true,
      value: { savePdfFromBase64: vi.fn(() => false) },
    });

    await expect(downloadPdfBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), "laporan.pdf"))
      .rejects.toThrow(/Android tidak dapat menyimpan PDF/);
  });
});
