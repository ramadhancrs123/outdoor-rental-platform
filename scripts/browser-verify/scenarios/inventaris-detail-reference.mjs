export default async function inventarisDetailReference({ page, capture }) {
  const viewport = page.viewportSize();
  await page.waitForTimeout(700);

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error("Horizontal overflow pada detail inventaris: " + JSON.stringify(metrics));
  }

  for (const label of ["Detail Unit Barang", "Informasi", "Aksi", "Riwayat", "Informasi Utama"]) {
    const locator = page.getByText(label, { exact: true }).first();
    if (!(await locator.count()) || !(await locator.isVisible().catch(() => false))) {
      throw new Error("Elemen detail inventaris tidak terlihat: " + label);
    }
  }

  const statusBadge = page.locator('[data-slot="badge"]').first();
  if (!(await statusBadge.count())) {
    throw new Error("Status unit tidak terlihat.");
  }

  const tabHistory = page.getByRole("button", { name: "Riwayat", exact: true });
  await tabHistory.click();
  const historyHeader = page.getByText("Riwayat Unit", { exact: true });
  if (!(await historyHeader.isVisible().catch(() => false))) throw new Error("Tab Riwayat tidak terbuka.");

  const historyCards = page.locator('[data-slot="card"]').filter({ hasText: /→|Riwayat Unit/ });
  const historyButton = page.getByRole("button", { name: /Lihat Semua|Ringkas/ }).first();
  const historyButtonCount = await historyButton.count();

  if (historyButtonCount > 0) {
    await historyButton.click();
    await historyButton.click();
  }

  await page.getByRole("navigation", { name: "Bagian detail unit" }).getByRole("button", { name: "Aksi", exact: true }).click();
  if (!(await page.getByText("Aksi Berikutnya", { exact: true }).isVisible().catch(() => false))) {
    throw new Error("Panel Aksi Berikutnya tidak tampil.");
  }

  const bodyText = await page.locator("body").innerText();
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  if (uuid.test(bodyText)) throw new Error("UUID teknis tampil pada UI detail inventaris.");

  if (viewport.width <= 430) {
    const nav = page.getByRole("navigation", { name: "Bagian detail unit" });
    if (!(await nav.count()) || !(await nav.isVisible().catch(() => false))) throw new Error("Navigasi detail mobile tidak terlihat.");
  }

  await capture("inventaris-detail-reference");
  return {
    state: "VERIFIED",
    viewport,
    overflow: false,
    historyExpandable: historyButtonCount > 0,
    technicalUuidVisible: false,
  };
}
