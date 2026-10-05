export default async function penyewaanDetailReference({ page, capture }) {
  if (page.url().endsWith("/penyewaan") || page.url().endsWith("/penyewaan/")) {
    const firstRentalNumber = page.getByText(/^RNT-\d{4}-\d+$/, { exact: true }).first();
    await firstRentalNumber.waitFor({ state: "visible", timeout: 10000 });
    await firstRentalNumber.click();
    const detailButton = page.getByRole("link", { name: "Lihat Detail Sewa" }).first();
    await detailButton.waitFor({ state: "visible", timeout: 10000 });
    await detailButton.click();
    await page.waitForURL((url) => /^\/penyewaan\/[^/]+$/.test(url.pathname), { timeout: 10000 });
  }

  const viewport = page.viewportSize();
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error("Horizontal overflow pada detail penyewaan.");
  }

  await page.getByTestId("rental-detail-root").waitFor({ state: "visible", timeout: 15000 });

  for (const label of ["Detail Penyewaan", "Keuangan"]) {
    const loc = page.getByText(label, { exact: true }).first();
    if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) {
      throw new Error("Elemen tidak terlihat: " + label);
    }
  }

  const unitDetailsSummary = page.locator("details > summary").filter({ hasText: "Penetapan Unit" }).first();
  await unitDetailsSummary.waitFor({ state: "visible", timeout: 10000 });

  const paymentButton = page.getByRole("button", { name: /Catat Pembayaran/i }).first();
  await paymentButton.waitFor({ state: "visible", timeout: 15000 });
  const detailUrl = page.url();
  await paymentButton.click();
  const paymentDialog = page.getByRole("dialog").first();
  await paymentDialog.waitFor({ state: "visible", timeout: 10000 });
  if (!(await paymentDialog.getByText("Pembayaran untuk Penyewaan", { exact: false }).count())) {
    throw new Error("Modal Catat Pembayaran tidak terbuka pada detail rental.");
  }
  if (page.url() !== detailUrl) {
    throw new Error("URL berubah saat membuka modal Catat Pembayaran.");
  }
  if (!(await paymentDialog.getByText(/RNT-\d{4}-\d+/, { exact: false }).count())) {
    throw new Error("Nomor rental tidak terlihat di modal pembayaran.");
  }
  await paymentDialog.getByRole("button", { name: "Batal" }).click();

  const contactPhone = page.getByRole("link", { name: /^Telepon /i }).first();
  const contactWhatsApp = page.getByRole("link", { name: /^Hubungi WhatsApp /i }).first();
  if ((await contactPhone.count()) !== (await contactWhatsApp.count())) {
    throw new Error("Aksi Telepon dan WhatsApp tidak konsisten pada kontak penyewa.");
  }
  if (await contactWhatsApp.count()) {
    const href = await contactWhatsApp.getAttribute("href");
    if (!href?.startsWith("https://wa.me/") || !href.includes("text=")) {
      throw new Error("Aksi WhatsApp belum membuat draft komunikasi yang valid.");
    }
  }

  const detailsCount = await page.locator("details").count();
  if (detailsCount < 3) {
    throw new Error("Section expandable detail penyewaan kurang dari 3.");
  }

  if (viewport.width <= 430) {
    const sticky = page.getByRole("link", { name: /Selesaikan Sewa/ }).first();
    if (await sticky.count()) {
      const box = await sticky.boundingBox();
      if (!box || box.width > viewport.width - 20) {
        throw new Error("CTA Selesaikan Sewa tidak compact pada mobile.");
      }
    }
  }

  const bodyText = await page.locator("body").innerText();
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  if (uuid.test(bodyText)) {
    throw new Error("UUID teknis masih tampil pada detail penyewaan.");
  }

  await capture("penyewaan-detail-reference");
  return {
    state: "VERIFIED",
    viewport,
    overflow: false,
    technicalUuidVisible: false,
    expandableSections: detailsCount,
  };
}
