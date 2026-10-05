export default async function inventarisHomeReference({ page, capture }) {
  const viewport = page.viewportSize();
  await page.waitForTimeout(1100);

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (metrics.scrollWidth > metrics.clientWidth) throw new Error("Horizontal overflow pada halaman utama Inventaris.");

  for (const label of ["Semua", "Daftarkan Unit"]) {
    const found = page.getByText(label, { exact: true }).first();
    if (!(await found.count()) || !(await found.isVisible().catch(() => false))) {
      throw new Error("Elemen utama tidak terlihat: " + label);
    }
  }

  const search = page.getByPlaceholder("Cari barang, kategori, atau kode unit...");
  if (!(await search.isVisible().catch(() => false))) throw new Error("Search utama tidak terlihat.");

  const categoryButtons = page.getByRole("button").filter({ hasText: /Semua|Tenda|Carrier|Sleeping Bag|Cooking/ });
  if ((await categoryButtons.count()) < 1) throw new Error("Filter kategori tidak terbentuk.");

  const cards = page.getByRole("link", { name: /Buka detail/ });
  if (!(await cards.count())) {
    const productLinks = page.locator('a[href*="/inventaris/barang/"]');
    if (!(await productLinks.count())) throw new Error("Kartu produk tidak terlihat.");
  }

  const body = await page.locator("body").innerText();
  if (body.includes("Kelola barang, unit fisik, lokasi, kesiapan sewa")) throw new Error("Copy header lama masih tampil.");
  if (body.includes("Mode inventaris")) throw new Error("Tab mode lama masih tampil di landing.");

  await capture("inventaris-home-reference");
  return { state: "VERIFIED", viewport, overflow: false };
}
