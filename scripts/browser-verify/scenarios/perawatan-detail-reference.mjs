export default async function perawatanDetailReference({ page, capture }) {
  const viewport = page.viewportSize();
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error("Horizontal overflow pada detail perawatan: " + JSON.stringify(metrics));
  }

  const mustShow = [
    "Detail Perawatan",
    "Ringkasan",
    "Alasan Perawatan",
    "Status Pekerjaan",
    "Detail Pekerjaan",
    "Riwayat Unit",
    "Informasi",
    "Pekerjaan",
    "Timeline",
  ];

  for (const label of mustShow) {
    if (!(await page.getByText(label, { exact: true }).first().isVisible().catch(() => false))) {
      throw new Error("Elemen detail perawatan tidak terlihat: " + label);
    }
  }

  const technicalIdPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  const bodyText = await page.locator("body").innerText();
  if (technicalIdPattern.test(bodyText)) {
    throw new Error("UUID teknis masih tampil pada UI detail perawatan.");
  }

  const timeline = page.locator("#timeline");
  if (!(await timeline.isVisible().catch(() => false))) {
    throw new Error("Timeline unit tidak terlihat.");
  }

  const historyButton = page.getByRole("button", { name: /Lihat Semua|Ringkas/ }).first();
  if (await historyButton.count()) {
    await historyButton.click();
    await historyButton.click();
  }

  if (viewport.width <= 430) {
    const header = page.getByText("Detail Perawatan", { exact: true }).first();
    const headerBox = await header.boundingBox();
    if (!headerBox || headerBox.width > viewport.width - 20) {
      throw new Error("Header detail perawatan tidak compact pada mobile.");
    }
  }

  await capture("perawatan-detail-reference");
  return {
    state: "VERIFIED",
    viewport,
    overflow: false,
    technicalUuidVisible: false,
  };
}
