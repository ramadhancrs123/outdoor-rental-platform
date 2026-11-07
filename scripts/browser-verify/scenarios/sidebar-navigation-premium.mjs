export default async function sidebarNavigationPremium({ page, capture }) {
  const viewport = page.viewportSize();
  const mobile = (viewport?.width ?? 1280) <= 768;

  if (mobile) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await page.locator('[data-slot="sidebar"]').waitFor({ state: "visible" });
  }

  const sidebar = page.locator('[data-slot="sidebar"]');
  await sidebar.getByText("Akasha Outdoor", { exact: true }).waitFor({ state: "visible" });
  await sidebar.getByText("sistem management Akasha", { exact: true }).waitFor({ state: "visible" });
  await page.waitForTimeout(250);
  if (mobile) await capture("sidebar-mobile-active-group");

  const customersGroup = sidebar.getByRole("button", { name: "Data & Pelanggan" });
  await customersGroup.waitFor({ state: "visible" });
  if (await customersGroup.getAttribute("aria-expanded") !== "true") {
    throw new Error("Grup mengikuti halaman aktif belum terbuka otomatis.");
  }
  await sidebar.getByRole("link", { name: "Penyewa", exact: true }).waitFor({ state: "visible" });

  const operationalGroup = sidebar.getByRole("button", { name: "Operasional" });
  await operationalGroup.click();
  for (const label of ["Reservasi", "Penyewaan", "Penjualan", "Perawatan"]) {
    await sidebar.getByRole("link", { name: label }).waitFor({ state: "visible" });
  }

  for (const removed of ["Permintaan", "Pengembalian", "Pemeriksaan"]) {
    if (await sidebar.getByRole("link", { name: removed, exact: true }).count()) {
      throw new Error(`Menu ${removed} seharusnya tidak tampil di sidebar.`);
    }
  }
  const maintenance = sidebar.getByRole("link", { name: "Perawatan", exact: true });
  const menuColor = await maintenance.locator("span").evaluate((node) => getComputedStyle(node).color);
  const expectedColor = mobile ? "rgb(244, 241, 237)" : "rgb(33, 29, 25)";
  if (menuColor !== expectedColor) {
    throw new Error(`Warna teks menu tidak sesuai. expected=${expectedColor}, actual=${menuColor}`);
  }

  const financeGroup = sidebar.getByRole("button", { name: "Keuangan" });
  await financeGroup.click();
  for (const label of ["Ringkasan Keuangan", "Transaksi", "Pembayaran", "Pengeluaran", "Akun & Kas", "Analisis Retail", "Investor"]) {
    await sidebar.getByRole("link", { name: label }).waitFor({ state: "visible" });
  }

  await operationalGroup.click();
  if (await operationalGroup.getAttribute("aria-expanded") !== "true") {
    throw new Error("Accordion grup tidak dapat dibuka kembali.");
  }

  await page.waitForTimeout(300);
  await capture("sidebar-groups");
  if (!mobile) {
    await page.locator('[data-slot="sidebar-rail"]').click();
    await page.locator('[data-slot="sidebar"][data-collapsible="icon"]').waitFor({ state: "visible" });
    const sidebarContent = sidebar.locator('[data-slot="sidebar-content"]');
    const scrollMetrics = await sidebarContent.evaluate((node) => ({
      overflowY: getComputedStyle(node).overflowY,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));
    if (!["auto", "scroll"].includes(scrollMetrics.overflowY) || scrollMetrics.scrollHeight <= scrollMetrics.clientHeight) {
      throw new Error(`Collapsed sidebar navigation is not scrollable: ${JSON.stringify(scrollMetrics)}`);
    }
    const finalMenuItem = sidebar.getByRole("link", { name: "Laporan" });
    await finalMenuItem.scrollIntoViewIfNeeded();
    await finalMenuItem.waitFor({ state: "visible" });
    await capture("sidebar-collapsed");
  } else {
    await sidebar.getByRole("link", { name: "Perawatan" }).click();
    await page.waitForURL(/\/perawatan$/);
    await page.locator('[data-slot="sidebar"]').waitFor({ state: "hidden" });
    await capture("sidebar-mobile-route");
  }

  return {
    state: "VERIFIED",
    viewport,
    responsiveMode: mobile ? "mobile-drawer" : "desktop",
    operationalItems: 4,
    financeItems: 7,
    accordionWorks: true,
    activeSectionAutoExpanded: true,
    collapsedIconNavigation: !mobile,
    removedLegacyItems: true,
    maintenanceInsideOperational: true,
    menuTextColor: menuColor,
  };
}
