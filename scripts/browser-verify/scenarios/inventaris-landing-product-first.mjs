export default async function inventarisLandingUx({ page, capture }) {
  const viewport = page.viewportSize();
  await page.waitForTimeout(1200);
  const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  if (metrics.scrollWidth > metrics.clientWidth) throw new Error("Horizontal overflow landing Inventaris.");
  for (const label of ["Inventaris", "Barang", "Semua Unit", "Paket", "Daftarkan Unit", "Kelola Lokasi", "Pindai QR"]) {
    const found = page.getByText(label, { exact: true }).first();
    if (!(await found.count()) || !(await found.isVisible().catch(() => false))) throw new Error("Elemen landing tidak terlihat: " + label);
  }
  const detailLinks = page.getByRole("link", { name: /Detail/ });
  if (!(await detailLinks.count())) throw new Error("Kartu barang tidak memiliki CTA Detail.");
  const unitCodes = page.getByText(/^TENDA-[A-Z]+-\\d{3}$/);
  if (await unitCodes.count()) throw new Error("Landing masih menampilkan kode unit sebagai daftar utama.");
  await capture("inventaris-landing-product-first");
  return { state: "VERIFIED", viewport, overflow: false, productCards: await detailLinks.count() };
}
