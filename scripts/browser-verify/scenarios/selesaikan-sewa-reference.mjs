export default async function selesaikanSewaReference({ page, capture }) {
  const viewport = page.viewportSize();

  if (page.url().endsWith("/pengembalian") || page.url().endsWith("/pengembalian/")) {
    const processLink = page.getByRole("link", { name: /Proses Pengembalian/i }).first();
    if (await processLink.count()) {
      await processLink.click();
      await page.waitForURL(/\/pengembalian\/[^/]+$/, { timeout: 10000 });
      await page.waitForTimeout(500);
    } else {
      const emptyState = page.getByText(/Tidak ada penyewaan dalam antrian pengembalian|Tidak ada rental dalam antrian return|Tidak ada hasil yang sesuai/i);
      if (await emptyState.count()) {
        await capture("queue-empty");
        return { state: "BLOCKED_FIXTURE", reason: "Tidak ada rental aktif dalam antrian Pengembalian pada fixture saat ini." };
      }
      throw new Error("Tidak menemukan action Proses Pengembalian pada antrian.");
    }
  }

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error("Horizontal overflow pada halaman Selesaikan Sewa.");
  }

  await page.getByTestId("return-detail-root").waitFor({ state: "visible", timeout: 15000 });

  for (const label of [
    "Selesaikan Sewa",
    "Progress Pengembalian",
    "Unit yang dikembalikan",
    "Catatan Penerimaan",
    "Diserahkan ke Pemeriksaan",
    "Riwayat Pengembalian",
  ]) {
    const loc = page.getByText(label, { exact: true }).first();
    if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) {
      throw new Error("Elemen tidak terlihat: " + label);
    }
  }

  if (viewport.width <= 430) {
    const scan = page.getByRole("button", { name: /Pindai QR Unit/ }).first();
    if (!(await scan.count()) || !(await scan.isVisible().catch(() => false))) {
      throw new Error("CTA QR mobile tidak terlihat.");
    }
  }

  const detailsCount = await page.locator("details").count();
  if (detailsCount < 3) {
    throw new Error("Section expandable pada halaman Selesaikan Sewa kurang dari 3.");
  }

  const bodyText = await page.locator("body").innerText();
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  if (uuid.test(bodyText)) {
    throw new Error("UUID teknis masih tampil pada Selesaikan Sewa.");
  }

  await capture("selesaikan-sewa-reference");
  return {
    state: "VERIFIED",
    viewport,
    overflow: false,
    technicalUuidVisible: false,
    expandableSections: detailsCount,
  };
}
