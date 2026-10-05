export default async function inventarisUnitPhotoUx({ page, capture }) {
  const viewport = page.viewportSize();
  await page.waitForTimeout(1000);
  const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  if (metrics.scrollWidth > metrics.clientWidth) throw new Error("Horizontal overflow detail unit.");
  for (const label of ["Detail Unit Barang", "Informasi", "Aksi", "Riwayat", "Foto Unit"]) {
    const found = page.getByText(label, { exact: true }).first();
    if (!(await found.count()) || !(await found.isVisible().catch(() => false))) throw new Error("Detail unit tidak menampilkan: " + label);
  }
  const addPhoto = page.getByRole("button", { name: "Tambah Foto" }).first();
  if (!(await addPhoto.count()) || !(await addPhoto.isVisible().catch(() => false))) throw new Error("Tombol Tambah Foto tidak terlihat.");
  await page.getByRole("navigation", { name: "Bagian detail unit" }).getByRole("button", { name: "Aksi", exact: true }).click();
  await page.waitForTimeout(150);
  const condition = page.getByRole("button", { name: /Koreksi Kondisi/ }).first();
  if (!(await condition.count()) || !(await condition.isVisible().catch(() => false))) {
    const body = await page.locator("body").innerText();
    throw new Error("Kontrol Koreksi Kondisi tidak ditemukan. BODY: " + body.slice(0, 2200));
  }
  const actionText = await page.locator("body").innerText();
  if (!/kesiapan|Siap Disewakan|kondisi/i.test(actionText)) throw new Error("Panel aksi tidak menunjukkan konteks kesiapan.");
  const bodyText = await page.locator("body").innerText();
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(bodyText)) throw new Error("UUID teknis tampil.");
  await capture("inventaris-unit-photo-ux");
  return { state: "VERIFIED", viewport, overflow: false, photoControl: true, conditionCorrectionControl: true };
}
