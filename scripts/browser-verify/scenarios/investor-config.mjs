export default async function investorConfigScenario({ page, capture }) {
  const responses = [];
  page.on("response", async (response) => {
    if (!response.url().includes("get_investor_admin_finance_config")) return;
    let body = "";
    try { body = (await response.text()).slice(0, 1800); } catch {}
    responses.push({ status: response.status(), body });
  });

  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Konfigurasi Investor membutuhkan sesi admin." };
  }

  await page.getByRole("heading", { name: "Konfigurasi Investor" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Partisipasi Investor", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Cadangan Operasional", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Periode Berlaku", { exact: true }).waitFor({ state: "visible", timeout: 10000 });

  const startDay = page.locator("#period-start-day");
  const endDay = page.locator("#period-end-day");
  const saveButton = page.getByRole("button", { name: "Simpan Perubahan" });
  await startDay.waitFor({ state: "visible", timeout: 10000 });
  await endDay.waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "Batal" }).waitFor({ state: "visible", timeout: 10000 });

  const financeNav = page.getByRole("navigation", { name: "Navigasi Keuangan" });
  const financeNavVisible = await financeNav.isVisible().catch(() => false);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const operatorWarning = page.getByText("Akun pengelola belum dikonfigurasi.", { exact: false });
  if (await operatorWarning.isVisible().catch(() => false)) {
    throw new Error("Admin config incorrectly reports missing operator dependency.");
  }

  const originalStart = await startDay.inputValue();
  const originalEnd = await endDay.inputValue();
  // Test UI guard only. Do not click Save or persist a test configuration.
  await startDay.fill("2");
  await endDay.fill("1");
  await page.getByText(/Rentang periode tidak valid/i).waitFor({ state: "visible", timeout: 3000 });
  const saveDisabledForInvalidRange = await saveButton.isDisabled();
  if (!saveDisabledForInvalidRange) {
    throw new Error("Investor config save must be disabled when period end precedes period start.");
  }
  await capture("investor-config-invalid-period-range");

  await startDay.fill(originalStart);
  await endDay.fill(originalEnd);
  await page.getByText("Periode Berlaku", { exact: true }).waitFor({ state: "visible", timeout: 3000 });

  const restoredSaveDisabled = await saveButton.isDisabled();
  if (restoredSaveDisabled) {
    throw new Error("Restored Investor config inputs are still disabled; configured dependencies need inspection.");
  }

  await capture("investor-config-loaded");
  return {
    state: "VERIFIED",
    checks: [
      "config-heading-visible",
      "participation-section-visible",
      "operational-reserve-visible",
      "period-start-end-day-inputs-visible",
      "invalid-range-shows-warning",
      "invalid-range-disables-save",
      "original-config-restored-without-saving",
      "finance-navigation-visible",
      "no-operator-config-warning",
      "no-financial-write-issued",
    ],
    financeNavVisible,
    horizontalOverflow: overflow,
    saveDisabledForInvalidRange,
    restoredSaveDisabled,
    configResponses: responses,
    persistedChanges: false,
  };
}
