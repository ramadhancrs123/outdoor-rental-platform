export default async function laporanScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Browser runner berada di halaman login setelah auth flow." };
  }

  await page.getByTestId("reports-page").waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("heading", { name: "Laporan" }).waitFor({ state: "visible", timeout: 10000 });

  for (let i = 0; i < 40; i += 1) {
    if (await page.getByText("Finance → Laporan").count()) break;
    if (await page.getByText(/Laporan gagal dimuat/i).count()) break;
    await page.waitForTimeout(500);
  }

  if (await page.getByText(/Laporan gagal dimuat/i).count()) {
    await capture("report-load-error");
    return { state: "FAILED", reason: "Financial report read-model failed to load." };
  }

  if (!(await page.getByText("Finance → Laporan").count())) {
    await capture("report-read-model-not-ready");
    return { state: "FAILED", reason: "Financial report read model did not become ready." };
  }

  await page.getByText("Source", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Tenant").waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Formula").waitFor({ state: "visible", timeout: 10000 });
  await capture("report-contract");

  return {
    state: "VERIFIED",
    sourceTrace: true,
    tenantScopeVisible: true,
    formulaVisible: true,
  };
}
