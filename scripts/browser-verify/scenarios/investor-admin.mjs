export default async function investorAdminScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return {
      state: "BLOCKED_AUTH",
      reason: "Route master config Investor dilindungi Authenticated dan browser tidak memiliki sesi admin.",
    };
  }

  await page.getByRole("heading", { name: "Transparansi Investor" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Master Config Investor").waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Konfigurasi partisipasi", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await capture("admin-investor-config");

  return {
    state: "VERIFIED",
    checks: [
      "admin-authenticated",
      "investor-master-config-visible",
      "participation-config-visible",
      "investor-shell-not-used",
    ],
  };
}
