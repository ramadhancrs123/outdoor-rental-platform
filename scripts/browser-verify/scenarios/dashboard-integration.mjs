export default async function dashboardIntegrationScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Browser runner berada di halaman login setelah auth flow." };
  }

  await page.getByTestId("dashboard-root").waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Perlu Perhatian").waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("link", { name: /^Laporan$/i }).first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("link", { name: /^Pemberitahuan$/i }).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await capture("dashboard-integration");

  return {
    state: "VERIFIED",
    interaction: ["dashboard-loaded", "attention-surface-visible", "report-entry-visible", "notification-entry-optional"],
  };
}
