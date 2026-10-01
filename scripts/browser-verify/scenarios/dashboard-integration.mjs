export default async function dashboardIntegrationScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Browser runner berada di halaman login setelah auth flow." };
  }

  await page.getByTestId("dashboard-root").waitFor({ state: "visible", timeout: 10000 });

  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const visibleTitle = (label) =>
    page.locator('[data-slot="card-title"]:visible').filter({ hasText: label }).first();

  const requiredSections =
    viewportWidth <= 768
      ? ["Perlu Tindakan", "Quick Action", "Today", "Current Rentals", "Returns", "Notifications"]
      : ["Perlu Tindakan", "Agenda Hari Ini", "Quick Actions", "Operational Snapshot", "Inventory", "Finance", "Recent Activity"];

  for (const label of requiredSections) {
    await visibleTitle(label).waitFor({ state: "visible", timeout: 10000 });
  }

  await page.getByRole("link", { name: /^Buka Laporan$/i }).waitFor({ state: "visible", timeout: 10000 });
  await capture("dashboard-integration");

  return {
    state: "VERIFIED",
    viewport: viewportWidth <= 768 ? "mobile" : "desktop",
    interaction: [
      "dashboard-loaded",
      "required-dashboard-surfaces-visible",
      "report-entry-visible",
    ],
  };
}
