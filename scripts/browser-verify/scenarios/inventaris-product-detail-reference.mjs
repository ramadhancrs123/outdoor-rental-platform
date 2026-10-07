export default async function inventarisProductDetailReference({ page, capture }) {
  const viewport = page.viewportSize();
  await page.waitForTimeout(1000);

  const metrics = await page.evaluate(() => {
    const base = { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
    const offenders = [...document.querySelectorAll("*")]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { tag: el.tagName, cls: String(el.className || "").slice(0,160), right: Math.round(rect.right), width: Math.round(rect.width), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0,120) };
      })
      .filter((item) => item.right > window.innerWidth + 1 || item.scrollWidth > item.clientWidth + 1)
      .sort((a,b) => b.right - a.right || b.scrollWidth - a.scrollWidth)
      .slice(0,8);
    return { ...base, offenders };
  });
  if (metrics.scrollWidth > metrics.clientWidth) throw new Error("Horizontal overflow detail barang: " + JSON.stringify(metrics));

  for (const label of ["Informasi", "Unit", "Riwayat", "Kesiapan Inventaris", "Daftar Unit Fisik"]) {
    const found = page.getByText(label, { exact: true }).first();
    if (!(await found.count()) || !(await found.isVisible().catch(() => false))) throw new Error("Detail barang tidak menampilkan: " + label);
  }
  const unitRows = page.locator('a[href*="/inventaris/"]').filter({ hasText: /TENDA-|CONSINA-|UNIT/i });
  if (!(await unitRows.count())) throw new Error("Preview unit fisik belum tampil di detail barang.");
  const body = await page.locator("body").innerText();
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(body)) throw new Error("UUID teknis tampil di UI detail barang.");
  await capture("inventaris-product-detail-reference");
  return { state: "VERIFIED", viewport, overflow: false, unitPreview: true };
}
