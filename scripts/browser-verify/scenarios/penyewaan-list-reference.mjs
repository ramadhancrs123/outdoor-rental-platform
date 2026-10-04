export default async function penyewaanListReference({ page, capture }) {
  const viewport = page.viewportSize();
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error("Horizontal overflow pada halaman penyewaan: " + JSON.stringify(metrics));
  }

  const visible = async (name, exact = true) => {
    const locator = page.getByText(name, { exact }).first();
    return locator.isVisible().catch(() => false);
  };

  const required = [
    "Penyewaan",
    "Daftar Penyewaan",
    "Usaha: Akasha Store",
    "Aturan Penyewaan",
    "Penyewaan Langsung",
    "Semua",
    "Tanggal",
    "Penyewa",
    "Status",
    "Sebelumnya",
    "Berikutnya",
  ];

  const missing = [];
  for (const name of required) {
    if (!(await visible(name))) missing.push(name);
  }

  const search = await page.getByPlaceholder("Nama penyewa, nomor rental, atau unit...").isVisible().catch(() => false);
  if (!search) missing.push("Nama penyewa, nomor rental, atau unit...");

  if (missing.length) {
    throw new Error("Kontrak visual penyewaan gagal: " + missing.join(", "));
  }

  const cardCount = await page.locator('[data-slot="accordion-item"]').count().catch(() => 0);
  if (cardCount < 1) {
    const rentalButtons = await page.locator('button[id^="radix-"]').count().catch(() => 0);
    if (rentalButtons < 1) throw new Error("Tidak ditemukan card/list penyewaan yang dapat dibuka.");
  }

  await capture("penyewaan-list-reference");
  return {
    state: "VERIFIED",
    viewport,
    overflow: false,
    cardCount,
  };
}
