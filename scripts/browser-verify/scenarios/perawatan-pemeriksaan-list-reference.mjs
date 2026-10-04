export default async function perawatanPemeriksaanListReference({ page, capture }) {
  const viewport = page.viewportSize();
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error("Horizontal overflow: " + JSON.stringify(metrics));
  }

  for (const name of ["Perawatan/Pemeriksaan", "Kondisi Unit", "Perawatan", "Pemeriksaan"]) {
    if (!(await page.getByText(name, { exact: true }).first().isVisible().catch(() => false))) {
      throw new Error("Elemen utama tidak terlihat: " + name);
    }
  }

  if (await page.getByRole("tab", { name: "Perawatan" }).count()) {
    await page.getByRole("tab", { name: "Perawatan" }).click().catch(() => {});
  }

  const maintenanceSearch = page.getByPlaceholder("Cari kode unit, barang, pelaksana, atau pekerjaan...");
  if (!(await maintenanceSearch.isVisible().catch(() => false))) {
    throw new Error("Search perawatan tidak terlihat.");
  }

  const maintenanceFilters = ["Perlu Tindakan", "Direncanakan", "Berjalan", "Selesai", "Semua"];
  for (const label of maintenanceFilters) {
    if (!(await page.getByRole("button", { name: label, exact: true }).isVisible().catch(() => false))) {
      throw new Error("Filter perawatan tidak terlihat: " + label);
    }
  }

  const maintenanceCards = page.locator('[data-slot="card"]').filter({ hasText: /Perlu Tindakan|Direncanakan|Berjalan|Selesai|Menunggu Verifikasi/ });
  if (await maintenanceCards.count() > 1) {
    const classes = await maintenanceCards.evaluateAll(nodes => nodes.slice(0, 4).map(n => n.getAttribute("class") || ""));
    const tones = new Set(classes.map(c => c.match(/bg-(?:card|emerald|sky|amber)-[^ ]+/)?.[0] || c));
    if (tones.size < 2) throw new Error("Card perawatan tidak memiliki pemisah visual yang cukup.");
  }

  const inspectionTabs = page.getByText("Pemeriksaan", { exact: true });
  for (let i = 0; i < await inspectionTabs.count(); i++) {
    if (await inspectionTabs.nth(i).isVisible().catch(() => false)) {
      await inspectionTabs.nth(i).click().catch(() => {});
      break;
    }
  }
  const inspectionSearch = page.getByPlaceholder("Cari kode unit, penyewa, atau nomor pengembalian...");
  if (!(await inspectionSearch.isVisible().catch(() => false))) {
    throw new Error("Search pemeriksaan tidak terlihat.");
  }

  const filterSection = inspectionSearch.locator("xpath=../..");
  const filterText = await filterSection.innerText().catch(() => "");
  for (const label of ["Semua", "Menunggu", "Dalam Proses", "Selesai"]) {
    if (!filterText.includes(label)) throw new Error("Filter pemeriksaan tidak ditemukan: " + label);
  }

  const inspectionCards = page.locator('[data-slot="card"]').filter({ hasText: /Menunggu Pemeriksaan|Pemeriksaan Berjalan|Pemeriksaan Selesai/ });
  if (await inspectionCards.count() > 1) {
    const classes = await inspectionCards.evaluateAll(nodes => nodes.slice(0, 4).map(n => n.getAttribute("class") || ""));
    const tones = new Set(classes.map(c => c.match(/bg-(?:card|emerald|sky|amber)-[^ ]+/)?.[0] || c));
    if (tones.size < 2) throw new Error("Card pemeriksaan tidak memiliki pemisah visual yang cukup.");
  }

  await capture("perawatan-pemeriksaan-list-reference");
  return {
    state: "VERIFIED",
    viewport,
    overflow: false,
    maintenanceCardCount: await maintenanceCards.count(),
    inspectionCardCount: await inspectionCards.count(),
  };
}
