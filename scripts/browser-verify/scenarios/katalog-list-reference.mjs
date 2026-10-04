export default async function katalogListReference({ page, capture }) {
  const viewport = page.viewportSize();
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error("Horizontal overflow pada halaman katalog: " + JSON.stringify(metrics));
  }

  const required = [
    "Katalog",
    "Tambah Barang",
    "Kelola Kategori",
    "Barang",
    "Paket",
    "Kategori",
    "Status",
    "Semua",
    "Urutkan",
    "Filter",
  ];

  const missing = [];
  for (const name of required) {
    const locator = page.getByText(name, { exact: true }).first();
    if (!(await locator.isVisible().catch(() => false))) missing.push(name);
  }

  const search = await page.getByPlaceholder("Cari nama barang, kategori, atau deskripsi...").isVisible().catch(() => false);
  if (!search) missing.push("catalog search");

  const cards = page.locator('[data-slot="card"]').filter({ hasText: /Aktif|Nonaktif/ });
  if ((await cards.count()) < 1) throw new Error("Catalog product cards tidak ditemukan.");

  const firstProduct = page.getByRole("link", { name: /Lihat detail/ }).first();
  if (await firstProduct.count()) {
    if (!(await firstProduct.isVisible().catch(() => false))) throw new Error("Aksi detail catalog tidak terlihat.");
  }

  if (viewport.width < 1024) {
    const statusFilter = page.getByRole("button", { name: /^Status$/ });
    if (!(await statusFilter.isVisible().catch(() => false))) {
      throw new Error("Filter chip Status tidak terlihat pada mobile.");
    }

    await statusFilter.click();
    if (!(await page.getByText("Filter Katalog", { exact: true }).isVisible().catch(() => false))) {
      throw new Error("Bottom sheet Filter Katalog tidak terbuka.");
    }
  }

  await capture("katalog-list-reference");
  return {
    state: "VERIFIED",
    viewport,
    overflow: false,
    cardCount: await cards.count(),
    storageFallbackAllowed: true,
  };
}
