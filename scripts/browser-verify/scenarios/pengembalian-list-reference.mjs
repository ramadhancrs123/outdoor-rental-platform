export default async function pengembalianListReference({ page, capture }) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error("Horizontal overflow pada halaman pengembalian: " + JSON.stringify(metrics));
  }

  const required = [
    "Pengembalian",
    "Antrian Pengembalian",
    "Menunggu",
    "Riwayat",
    "Scan QR",
    "Semua",
    "Batas",
    "Status",
    "Penyewa",
  ];

  const missing = [];
  for (const name of required) {
    const locator = page.getByText(name, { exact: true }).first();
    if (!(await locator.isVisible().catch(() => false))) missing.push(name);
  }

  const search = await page.getByPlaceholder("Cari nomor penyewaan, nama penyewa, nomor telepon, atau kode unit...").isVisible().catch(() => false);
  if (!search) missing.push("return search");

  const cards = page.locator('[data-slot="card"]');
  if ((await cards.count()) < 1) throw new Error("Card pengembalian tidak ditemukan.");

  const toggle = page.getByRole("button", { name: "Buka detail pengembalian" }).first();
  if (await toggle.count()) {
    await toggle.click();
    const action = page.getByRole("link", { name: /Proses Pengembalian|Lihat Pengembalian/ }).first();
    if (!(await action.isVisible().catch(() => false))) throw new Error("Aksi pada detail card tidak muncul setelah expand.");
  }

  await page.getByRole("button", { name: /^Status$/ }).click().catch(() => null);
  if (!(await page.getByText("Filter Pengembalian", { exact: true }).isVisible().catch(() => false))) {
    throw new Error("Bottom sheet filter pengembalian tidak terbuka.");
  }

  await capture("pengembalian-list-reference");
  return {
    state: "VERIFIED",
    viewport: page.viewportSize(),
    overflow: false,
    cardCount: await cards.count(),
  };
}
