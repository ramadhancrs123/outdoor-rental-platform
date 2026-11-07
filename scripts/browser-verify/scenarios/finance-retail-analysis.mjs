export default async function financeRetailAnalysisScenario({ page, capture }) {
  await page.getByRole("heading", { name: "Analisis Retail" }).waitFor({ state: "visible" });
  for (const label of [
    "Omzet penjualan",
    "HPP terhitung",
    "Laba kotor terhitung",
    "Kelengkapan HPP",
    "Kinerja Barang & Varian",
    "Posisi Stok Saat Ini",
    "Riwayat Pembelian & Penerimaan",
    "Penjualan Terbaru",
  ]) {
    await page.getByText(label, { exact: false }).first().waitFor({ state: "visible" });
  }

  await page.locator('a[href="/keuangan"]').filter({ hasText: "Keuangan" }).last().waitFor({ state: "visible" });

  const dimensions = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    documentHeight: document.documentElement.scrollHeight,
  }));
  if (dimensions.bodyWidth > dimensions.viewportWidth + 2) {
    throw new Error(
      "Horizontal overflow pada Analisis Retail: body " +
      dimensions.bodyWidth + "px, viewport " + dimensions.viewportWidth + "px.",
    );
  }

  await capture("finance-retail-analysis-loaded");
  console.log("FINANCE_RETAIL_LAYOUT", JSON.stringify(dimensions));
  return { state: "VERIFIED", dimensions };
}
