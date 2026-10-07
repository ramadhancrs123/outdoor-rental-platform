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

  for (const name of ["Katalog", "Tambah Barang", "Barang", "Paket", "Kategori", "Status", "Semua", "Urutkan", "Filter"]) {
    const locator = page.getByText(name, { exact: true }).first();
    if (!(await locator.isVisible().catch(() => false))) {
      throw new Error("Elemen katalog tidak terlihat: " + name);
    }
  }

  const tabBar = page.getByRole("tablist").first();
  if (!(await tabBar.isVisible().catch(() => false))) {
    throw new Error("Tab Barang/Paket tidak terlihat.");
  }

  const barangTab = page.getByRole("tab", { name: /Barang/ }).first();
  const paketTab = page.getByRole("tab", { name: /^Paket$/ }).first();
  if (!(await barangTab.isVisible()) || !(await paketTab.isVisible())) {
    throw new Error("Tab Barang/Paket tidak lengkap.");
  }

  await paketTab.click();
  if (!(await page.getByRole("heading", { name: "Paket Sewa", exact: true }).isVisible().catch(() => false))) {
    throw new Error("Tab Paket tidak membawa ke list Paket Sewa. BODY=" + (await page.locator("body").innerText()).slice(0, 5000));
  }
  if (!(await barangTab.isVisible().catch(() => false))) {
    throw new Error("Tab Barang menghilang setelah pindah ke Paket.");
  }

  await barangTab.click();
  if (!(await page.getByPlaceholder("Cari nama barang, kategori, atau deskripsi...").isVisible().catch(() => false))) {
    throw new Error("Tab Barang tidak kembali ke list barang.");
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
    tabNavigation: true,
  };
}
