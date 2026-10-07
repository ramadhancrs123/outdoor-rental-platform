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
  ];

  for (const label of requiredSections) {
    await page.getByRole("heading", { name: label, exact: true }).waitFor({ state: "visible", timeout: 10000 });
  }

  await page.getByText("Operational control center", { exact: true }).waitFor({ state: "visible", timeout: 10000 });

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
