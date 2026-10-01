export default async function inventoryConditionRecoveryScenario({ page, baseURL, capture }) {
  const unitId = "e0306731-2258-4d65-8175-98620014b820";
  await page.goto(baseURL + "/inventaris/" + unitId, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  await page.getByRole("button", { name: /^Koreksi Kondisi$/i }).click();
  await page.getByText("Koreksi Kondisi", { exact: true }).last().waitFor({ state: "visible", timeout: 15000 });

  const labels = page.locator("label");
  const conditionInput = labels.filter({ hasText: "Kondisi Ringkas Baru" }).locator("input");
  const reasonInput = labels.filter({ hasText: "Alasan Koreksi" }).locator("input");
  await conditionInput.fill("Baik, lengkap");
  await reasonInput.fill("Verifikasi flowback ADR-008");
  await capture("adr008-condition-recovery-form");

  await page.getByRole("button", { name: /Simpan Koreksi$/i }).click();
  await page.getByText("Koreksi kondisi berhasil dicatat", { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Baik, lengkap", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  await capture("adr008-condition-recovery-success");

  return {
    state: "VERIFIED",
    unitId,
    condition: "Baik, lengkap",
  };
}
