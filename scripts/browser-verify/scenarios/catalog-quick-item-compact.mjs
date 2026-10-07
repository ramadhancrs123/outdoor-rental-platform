export default async function katalogQuickItemCompact({ page, baseURL, capture }) {
  await page.goto(baseURL + "/katalog/tambah", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);

  const viewport = page.viewportSize();
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error("Horizontal overflow Quick Item: " + JSON.stringify(metrics));
  }

  const mobile = viewport.width <= 430;
  if (mobile) {
    if (!(await page.getByRole("heading", { name: "Tambah Barang", exact: true }).isVisible().catch(() => false))) {
      throw new Error("Mobile header compact tidak terlihat.");
    }
    if (!(await page.getByRole("button", { name: "Simpan", exact: true }).isVisible().catch(() => false))) {
      throw new Error("Tombol Simpan mobile tidak terlihat.");
    }
    for (const label of ["Foto Produk", "Informasi Dasar", "Pengaturan Sewa", "Lokasi & Lainnya", "Variasi Barang", "Kontrol Lanjutan"]) {
      const found = page.getByText(label, { exact: true }).first();
      if (!(await found.isVisible().catch(() => false))) throw new Error("Section mobile tidak terlihat: " + label);
    }
    const desktopHeading = page.getByText("Tambahkan barang siap disewakan", { exact: true }).first();
    if (await desktopHeading.isVisible().catch(() => false)) throw new Error("Header desktop masih tampil pada mobile.");
    const bottomCardText = page.getByText("Siap ditambahkan?", { exact: true }).first();
    if (await bottomCardText.isVisible().catch(() => false)) throw new Error("CTA bawah desktop masih memenuhi mobile.");
  } else {
    if (!(await page.getByText("Tambahkan barang siap disewakan", { exact: true }).isVisible().catch(() => false))) {
      throw new Error("Header desktop tidak terlihat.");
    }
    const mobileHeader = page.getByRole("heading", { name: "Tambah Barang", exact: true }).first();
    if (await mobileHeader.isVisible().catch(() => false)) throw new Error("Header mobile terlihat pada desktop.");
  }

  await capture(mobile ? "catalog-quick-item-compact-mobile" : "catalog-quick-item-compact-desktop");
  return { state: "VERIFIED", viewport, overflow: false, mobile };
}
