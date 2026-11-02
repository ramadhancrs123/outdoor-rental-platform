export default async function catalogPackagePromoSaveAdminUi({ page, capture }) {
  const promoFixture = {
    promosi_paket_id: "11111111-1111-4111-8111-111111111111",
    usaha_id: "b0dc9553-1a62-4599-85d7-51a288d33567",
    paket_sewa_id: "0fcab497-fd8b-40e5-b4c9-0b28901deebb",
    tarif_sewa_id: "27b76e0a-2649-485a-8fa7-df4cd0c50231",
    harga_normal: 80000,
    harga_promo: 65000,
    status: "active",
    started_at: new Date(Date.now() - 60_000).toISOString(),
    ended_at: null,
    updated_at: "2026-11-02T00:00:00.000Z",
  };
  const rpcCalls = [];

  await page.route("**/rest/v1/promosi_paket_sewa**", async (route) => {
    if (route.request().method() !== "GET") {
      throw new Error("Promo read model must remain read-only during this scenario.");
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([promoFixture]),
    });
  });

  await page.route("**/rest/v1/rpc/**", async (route) => {
    const request = route.request();
    const name = new URL(request.url()).pathname.split("/").pop();
    const body = request.postDataJSON();
    rpcCalls.push({ name, body });

    if (name === "command_update_paket_sewa") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          paket_sewa_id: promoFixture.paket_sewa_id,
          usaha_id: promoFixture.usaha_id,
          nama: "Paket camping 2 orang",
          harga_dasar: 80000,
          status: "active",
          is_public: true,
          updated_at: "2026-11-02T00:10:00.000Z",
        }),
      });
      return;
    }

    if (name === "command_set_paket_promo") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          usaha_id: promoFixture.usaha_id,
          paket_sewa_id: promoFixture.paket_sewa_id,
          tarif_sewa_id: promoFixture.tarif_sewa_id,
          enabled: true,
          promosi_paket_id: promoFixture.promosi_paket_id,
          harga_normal: 80000,
          harga_promo: 60000,
          updated_at: "2026-11-02T00:10:01.000Z",
        }),
      });
      return;
    }

    throw new Error("Unexpected RPC during promo-only save: " + name);
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Harga Paket", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Informasi Tambahan", { exact: true }).click();

  const promoSwitch = page.getByRole("switch").first();
  await promoSwitch.waitFor({ state: "visible" });
  if (!(await promoSwitch.isChecked())) {
    throw new Error("Promo active state was not loaded.");
  }

  const regularPrice = page.getByRole("textbox", { name: "Harga Paket" });
  const promoPrice = page.getByRole("textbox", { name: "Harga Promo Paket" });
  if ((await regularPrice.inputValue()) !== "80000") {
    throw new Error("Regular package price did not remain Rp80,000.");
  }

  await promoPrice.fill("60000");
  await capture("catalog-package-promo-save-before");

  await page.getByRole("button", { name: "Simpan Perubahan", exact: true }).click();
  await page.waitForURL(/\/katalog\?view=packages/, { timeout: 15000 });

  const packageUpdateIndex = rpcCalls.findIndex((call) => call.name === "command_update_paket_sewa");
  const promoUpdateIndex = rpcCalls.findIndex((call) => call.name === "command_set_paket_promo");
  if (packageUpdateIndex < 0 || promoUpdateIndex < 0 || packageUpdateIndex >= promoUpdateIndex) {
    throw new Error("Package metadata must be saved first, then promo command must be applied.");
  }
  const promoCall = rpcCalls[promoUpdateIndex];
  if (promoCall.body.p_enabled !== true || promoCall.body.p_harga_promo !== 60000) {
    throw new Error("Trusted promo command did not receive the edited effective price.");
  }
  if (promoCall.body.p_expected_updated_at !== promoFixture.updated_at) {
    throw new Error("Promo optimistic concurrency timestamp was not passed.");
  }
  if (rpcCalls.some((call) => call.name === "command_update_tarif_sewa" || call.name === "command_set_tarif_status")) {
    throw new Error("Changing only the promo price must not mutate or deactivate the normal tariff.");
  }

  return {
    state: "VERIFIED",
    rpcOrder: rpcCalls.map((call) => call.name),
    normalPriceSubmitted: 80000,
    promoPriceSubmitted: promoCall.body.p_harga_promo,
    expectedPromoUpdatedAt: promoCall.body.p_expected_updated_at,
    checks: [
      "promo-active-form-hydration",
      "normal-tariff-unchanged",
      "package-update-before-promo-command",
      "trusted-promo-rpc-payload",
      "optimistic-concurrency-token",
      "no-tariff-mutation",
      "save-navigation",
    ],
  };
}
