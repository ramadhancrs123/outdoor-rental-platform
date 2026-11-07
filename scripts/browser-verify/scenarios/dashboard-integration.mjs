export default async function dashboardIntegrationScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Browser runner berada di halaman login setelah auth flow." };
  }

  await page.getByTestId("dashboard-root").waitFor({ state: "visible", timeout: 10000 });
  await page.locator("h1").filter({ hasText: "Selamat datang" }).waitFor({ state: "visible", timeout: 10000 });

  const requiredSections = [
    "Perlu Tindakan",
    "Aksi Cepat",
    "Hari Ini",
    "Rental Berjalan",
    "Aktivitas Terbaru",
    "Arus Kas Usaha",
  ];

  for (const label of requiredSections) {
    await page.getByRole("heading", { name: label, exact: true }).waitFor({ state: "visible", timeout: 10000 });
  }

  await page.getByText("Aktivitas rental & retail", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Promo Aktif", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Total Transaksi", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByTestId("dashboard-net-cash").waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Net Cash", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByTestId("dashboard-cashflow-difference").waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Selisih", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  if (await page.getByText(/Grafik mengikuti tanggal transaksi/).count()) {
    throw new Error("Catatan teknis yang diminta dihapus masih muncul pada dashboard.");
  }
  await page.getByRole("button", { name: "Line", exact: true }).click();
  if (await page.getByRole("button", { name: "Line", exact: true }).getAttribute("aria-pressed") !== "true") {
    throw new Error("Pilihan grafik Line tidak aktif setelah dipilih.");
  }
  await page.getByRole("button", { name: "Area", exact: true }).click();
  if (await page.getByRole("button", { name: "Area", exact: true }).getAttribute("aria-pressed") !== "true") {
    throw new Error("Pilihan grafik Area tidak aktif setelah dipilih.");
  }

  await page.getByRole("button", { name: "Atur periode keuangan", exact: true }).click();
  await page.getByRole("button", { name: "Rentang", exact: true }).click();
  await page.getByLabel("Tanggal mulai").fill("2026-09-01");
  await page.getByLabel("Tanggal selesai").fill("2026-09-15");

  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));

  if (overflow.hasHorizontalOverflow) {
    throw new Error(
      `Dashboard horizontal overflow pada viewport ${overflow.viewport}px: scrollWidth=${overflow.width}px.`,
    );
  }

  const interaction = [
    "dashboard-loaded",
    "redesigned-dashboard-sections-visible",
    "responsive-no-horizontal-overflow",
    "compact-period-control",
    "custom-period-range",
  ];

  const inventoryDisclosure = page.locator("summary").filter({ hasText: "Kondisi Inventaris" }).first();
  await inventoryDisclosure.click();
  await page.getByText("Ready", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  interaction.push("inventory-summary-expandable");

  if (viewportWidth <= 359) {
    const expandActivity = page.getByRole("button", { name: "Tampilkan lebih banyak", exact: true });
    if (await expandActivity.count()) {
      await expandActivity.click();
      await page.getByText("Ringkas", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
      interaction.push("activity-feed-expandable-on-narrow-mobile");
    }
  }

  await capture("dashboard-redesign");

  return {
    state: "VERIFIED",
    viewport: viewportWidth <= 768 ? "mobile" : "desktop",
    interaction,
    overflow,
  };
}
