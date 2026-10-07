export default async function pemeriksaanDetailReference({ page, capture }) {
  const viewport = page.viewportSize();
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error("Horizontal overflow pada detail pemeriksaan: " + JSON.stringify(metrics));
  }

  await page.waitForTimeout(800);
  const required = [
    "Detail Pemeriksaan",
    "Konteks",
    "Hasil & Keputusan",
    "Temuan",
    "Bukti Foto",
    "Catatan",
    "Tinjau & Simpan",
    "Riwayat Pemeriksaan",
  ];
  for (const label of required) {
    const locator = page.getByText(label, { exact: true }).first();
    const count = await locator.count();
    const visible = await locator.isVisible().catch(() => false);
    if (!count || !visible) {
      throw new Error("Elemen detail pemeriksaan tidak terlihat: " + label);
    }
  }

  const technicalIdPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  const bodyText = await page.locator("body").innerText();
  if (technicalIdPattern.test(bodyText)) {
    throw new Error("UUID teknis masih tampil pada UI detail pemeriksaan.");
  }

  const history = page.locator("#riwayat");
  if (!(await history.isVisible().catch(() => false))) {
    throw new Error("Riwayat Pemeriksaan tidak terlihat.");
  }

  const historyButton = page.getByRole("button", { name: /Lihat Semua|Ringkas/ }).first();
  if (await historyButton.count()) {
    await historyButton.click();
    await historyButton.click();
  }

  if (viewport.width <= 430) {
    const nav = page.getByRole("navigation", { name: "Bagian detail pemeriksaan" });
    if (!(await nav.isVisible().catch(() => false))) {
      throw new Error("Navigasi section mobile tidak terlihat.");
    }
  }

  await capture("pemeriksaan-detail-reference");
  return {
    state: "VERIFIED",
    viewport,
    overflow: false,
    technicalUuidVisible: false,
  };
}
