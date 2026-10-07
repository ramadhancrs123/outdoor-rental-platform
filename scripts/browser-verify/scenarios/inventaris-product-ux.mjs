export default async function inventarisProductUx({ page, capture }) {
  const viewport = page.viewportSize();
  await page.waitForTimeout(1500);
  const body = await page.locator("body").innerText();
  const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  if (metrics.scrollWidth > metrics.clientWidth) throw new Error("Horizontal overflow: " + JSON.stringify(metrics));
  const hasError = /Detail barang Inventaris belum tersedia|Ringkasan produk Inventaris belum dapat dimuat|Barang tidak ditemukan/i.test(body);
  if (hasError) throw new Error("Product detail error: " + body.slice(0, 1800));
  for (const label of ["Informasi", "Unit", "Riwayat"]) {
    const locator = page.getByRole("button", { name: label, exact: true }).first();
    if (!(await locator.count()) || !(await locator.isVisible().catch(() => false))) {
      throw new Error("Tab tidak terlihat: " + label + "\\nBODY:\\n" + body.slice(0, 2400));
    }
  }
  if (!(await page.getByText("Kesiapan Inventaris", { exact: true }).isVisible().catch(() => false))) {
    throw new Error("Kesiapan Inventaris tidak terlihat.\\nBODY:\\n" + body.slice(0, 2400));
  }
  await page.getByRole("button", { name: "Unit", exact: true }).click();
  await page.waitForTimeout(250);
  if (!(await page.getByText(/Daftar Unit/).count())) throw new Error("Daftar Unit tidak terbuka.");
  await page.getByRole("button", { name: "Riwayat", exact: true }).click();
  await page.waitForTimeout(250);
  if (!(await page.getByText("Riwayat Aktivitas", { exact: true }).isVisible().catch(() => false))) throw new Error("Riwayat Aktivitas tidak terbuka.");
  const bodyText = await page.locator("body").innerText();
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(bodyText)) throw new Error("UUID teknis tampil.");
  await capture("inventaris-product-ux");
  return { state: "VERIFIED", viewport, overflow: false };
}
