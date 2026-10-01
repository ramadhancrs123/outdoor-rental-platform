export default async function inventoryRegisterReadyScenario({ page, baseURL, capture }) {
  const code = "ADR008-" + Math.floor(Date.now() / 1000);
  await page.goto(baseURL + "/inventaris/create", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  await page.getByLabel("Barang").click();
  const productOptions = page.getByRole("option");
  await productOptions.first().click();

  await page.getByLabel("Kode unit").fill(code);
  await capture("adr008-register-form");

  await page.getByRole("button", { name: /^Lanjutkan$/i }).click();
  await page.getByRole("button", { name: /Tinjauan Pendaftaran/i }).click();
  await capture("adr008-register-review");

  await page.getByRole("button", { name: /^Daftarkan Unit$/i }).click();
  await page.getByText("Unit berhasil didaftarkan", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Siap Disewakan", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Registrasi adalah konfirmasi kelayakan awal", { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  await capture("adr008-register-success");

  return {
    state: "VERIFIED",
    code,
    success: true,
  };
}
