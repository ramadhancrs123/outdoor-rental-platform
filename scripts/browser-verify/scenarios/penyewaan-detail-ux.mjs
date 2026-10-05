export default async function rentalDetailUx({ page, capture }) {
  if (page.url().endsWith("/penyewaan") || page.url().endsWith("/penyewaan/")) {
    const firstRentalNumber = page.getByText(/^RNT-\d{4}-\d+$/, { exact: true }).first();
    await firstRentalNumber.waitFor({ state: "visible", timeout: 15000 });
    await firstRentalNumber.click();
    const detailButton = page.getByRole("link", { name: "Lihat Detail Sewa" }).first();
    await detailButton.waitFor({ state: "visible", timeout: 10000 });
    await detailButton.click();
    await page.waitForURL((url) => /^\/penyewaan\/[^/]+$/.test(url.pathname), { timeout: 10000 });
  }

  await page.getByTestId("rental-detail-root").waitFor({ state: "visible", timeout: 15000 });

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error("Horizontal overflow pada detail penyewaan.");
  }

  for (const label of ["Detail Penyewaan", "Keuangan"]) {
    const loc = page.getByText(label, { exact: true }).first();
    await loc.waitFor({ state: "visible", timeout: 15000 });
  }

  const details = page.locator("details");
  const detailsCount = await details.count();
  if (detailsCount < 3) {
    throw new Error("Section progressive disclosure kurang dari 3.");
  }

  for (const label of ["Daftar Penyewaan", "Status Pengembalian", "Detail Penyewaan"]) {
    const summary = page.locator("details > summary").filter({ hasText: label }).first();
    await summary.waitFor({ state: "visible", timeout: 10000 });
  }

  const paymentButtons = page.getByRole("button", { name: /Catat Pembayaran/i });
  let paymentButton = null;
  for (let index = 0; index < await paymentButtons.count(); index += 1) {
    const candidate = paymentButtons.nth(index);
    if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) {
      paymentButton = candidate;
      break;
    }
  }
  if (!paymentButton) {
    throw new Error("Tidak ada CTA Catat Pembayaran yang terlihat dan aktif.");
  }

  const detailUrl = page.url();
  await paymentButton.click();

  const paymentDialog = page.getByRole("dialog").first();
  await paymentDialog.waitFor({ state: "visible", timeout: 15000 });
  if (!(await paymentDialog.getByText("Pembayaran untuk Penyewaan", { exact: false }).count())) {
    throw new Error("Modal Catat Pembayaran tidak terbuka.");
  }
  if (page.url() !== detailUrl) {
    throw new Error("URL berubah saat membuka modal pembayaran.");
  }
  if (!(await paymentDialog.getByText(/RNT-\d{4}-\d+/, { exact: false }).count())) {
    throw new Error("Nomor rental tidak terlihat di modal pembayaran.");
  }
  await paymentDialog.getByRole("button", { name: "Batal" }).click();

  const phone = page.getByRole("link", { name: /^Telepon /i }).first();
  const whatsapp = page.getByRole("link", { name: /^Hubungi WhatsApp /i }).first();
  const phoneCount = await phone.count();
  const whatsappCount = await whatsapp.count();
  if (phoneCount !== whatsappCount) {
    throw new Error("Aksi Telepon dan WhatsApp tidak konsisten.");
  }
  if (whatsappCount) {
    const href = await whatsapp.getAttribute("href");
    if (!href?.startsWith("https://wa.me/") || !href.includes("text=")) {
      throw new Error("Aksi WhatsApp belum valid.");
    }
  }

  const bodyText = await page.locator("body").innerText();
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  if (uuid.test(bodyText)) {
    throw new Error("UUID teknis masih tampil pada detail penyewaan.");
  }

  await capture("penyewaan-detail-ux");
  return {
    state: "VERIFIED",
    viewport: page.viewportSize(),
    overflow: false,
    expandableSections: detailsCount,
    paymentModalSameUrl: true,
    contactActions: phoneCount === whatsappCount,
    technicalUuidVisible: false,
  };
}
