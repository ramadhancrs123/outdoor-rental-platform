export default async function laporanAndroidBridgeScenario({ page, capture }) {
  await page.getByTestId("reports-page").waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("heading", { name: "Laporan" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "Ekspor Excel (.xlsx)" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "Ekspor PDF" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Transaksi Keuangan", { exact: true }).waitFor({ state: "visible", timeout: 10000 });

  await page.evaluate(() => {
    const target = window;
    target.__reportDownloadCalls = [];
    target.AndroidInterface = {
      saveXlsxFromBase64(base64Payload, fileName) {
        const bytes = Uint8Array.from(atob(base64Payload.slice(0, 32)), (character) => character.charCodeAt(0));
        target.__reportDownloadCalls.push({
          kind: "xlsx",
          fileName,
          base64Length: base64Payload.length,
          signature: Array.from(bytes.slice(0, 4)),
        });
        return true;
      },
      savePdfFromBase64(base64Payload, fileName) {
        const bytes = Uint8Array.from(atob(base64Payload.slice(0, 32)), (character) => character.charCodeAt(0));
        target.__reportDownloadCalls.push({
          kind: "pdf",
          fileName,
          base64Length: base64Payload.length,
          signature: Array.from(bytes.slice(0, 5)),
        });
        return true;
      },
    };
  });
  await capture("android-bridge-injected");

  const exportNative = async (kind, moduleName) => {
    const before = await page.evaluate(() => window.__reportDownloadCalls.length);
    await page.getByRole("button", { name: kind === "xlsx" ? "Ekspor Excel (.xlsx)" : "Ekspor PDF" }).click();
    await page.waitForFunction(
      ({ beforeCount }) => window.__reportDownloadCalls.length > beforeCount,
      { beforeCount: before },
      { timeout: 60000 },
    );
    const call = await page.evaluate((index) => window.__reportDownloadCalls[index], before);
    const expectedPrefix = kind === "xlsx" ? [0x50, 0x4b, 0x03, 0x04] : [0x25, 0x50, 0x44, 0x46, 0x2d];
    if (!call || call.kind !== kind || !call.fileName.endsWith(kind === "xlsx" ? ".xlsx" : ".pdf")) {
      throw new Error(moduleName + " " + kind.toUpperCase() + " did not use the correct Android bridge.");
    }
    if (call.base64Length < 1000 || JSON.stringify(call.signature) !== JSON.stringify(expectedPrefix)) {
      throw new Error(moduleName + " " + kind.toUpperCase() + " payload signature/length is invalid.");
    }
    return call;
  };

  const financeXlsx = await exportNative("xlsx", "keuangan");
  const financePdf = await exportNative("pdf", "keuangan");

  await page.getByRole("button", { name: "Penyewaan", exact: true }).click();
  await page.waitForURL(/modul=penyewaan/, { timeout: 5000 });
  await page.getByText("Daftar Penyewaan", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await capture("android-bridge-rental-report-ready");

  const rentalXlsx = await exportNative("xlsx", "penyewaan");
  const rentalPdf = await exportNative("pdf", "penyewaan");
  await capture("android-bridge-export-complete");

  const calls = await page.evaluate(() => window.__reportDownloadCalls);
  if (calls.length !== 4) {
    throw new Error("Expected four native export calls; got " + calls.length + ".");
  }

  return {
    state: "VERIFIED",
    mode: "AndroidInterface bridge simulation",
    note: "Browser verified the exact JS bridge contract. Android filesystem persistence is covered by native source/build, not a physical device test.",
    calls,
    financeXlsx: financeXlsx.fileName,
    financePdf: financePdf.fileName,
    rentalXlsx: rentalXlsx.fileName,
    rentalPdf: rentalPdf.fileName,
  };
}
