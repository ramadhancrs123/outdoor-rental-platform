export default async function catalogPackagePromoAdminUi({ page, capture }) {
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
    updated_at: new Date().toISOString(),
  };

  let promoReads = 0;
  let writeAttempts = 0;
  await page.route("**/rest/v1/promosi_paket_sewa**", async (route) => {
    if (route.request().method() !== "GET") {
      writeAttempts += 1;
      await route.continue();
      return;
    }
    promoReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([promoFixture]),
    });
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Harga Paket", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Informasi Tambahan", { exact: true }).click();

  const switches = page.getByRole("switch");
  if ((await switches.count()) < 2) {
    throw new Error("Switch promo dan visibilitas paket tidak ditemukan.");
  }

  const promoSwitch = switches.first();
  await promoSwitch.waitFor({ state: "visible" });
  if (!(await promoSwitch.isChecked())) {
    throw new Error("Promo aktif dari backend tidak terhidrasi ke form katalog.");
  }

  const normalPriceInput = page.getByRole("textbox", { name: "Harga Paket" });
  const promoPriceInput = page.getByRole("textbox", { name: "Harga Promo Paket" });
  if ((await normalPriceInput.inputValue()) !== "80000") {
    throw new Error("Harga sewa normal harus tetap Rp80.000, bukan tertimpa harga promo.");
  }
  if ((await promoPriceInput.inputValue()) !== "65000") {
    throw new Error("Harga promo Rp65.000 tidak terhidrasi dari data promo aktif.");
  }

  await promoSwitch.click();
  await promoPriceInput.waitFor({ state: "hidden", timeout: 5000 });
  await promoSwitch.click();
  await promoPriceInput.waitFor({ state: "visible", timeout: 5000 });
  if ((await promoPriceInput.inputValue()) !== "65000") {
    throw new Error("Toggle OFF/ON menghilangkan nilai input promo yang sedang diedit.");
  }

  await promoPriceInput.fill("60000");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflow) throw new Error("Form promo katalog menimbulkan horizontal overflow.");

  await capture("catalog-package-promo-form");
  if (promoReads < 1) throw new Error("Read model promo tidak diminta oleh halaman katalog.");
  if (writeAttempts > 0) throw new Error("Skenario visual seharusnya tidak menulis perubahan promo.");

  return {
    state: "VERIFIED",
    normalPrice: await normalPriceInput.inputValue(),
    editedPromoPrice: await promoPriceInput.inputValue(),
    promoReadRequests: promoReads,
    writeAttempts,
    checks: ["promo-hydration", "normal-price-preserved", "toggle-on-off", "promo-price-edit", "no-horizontal-overflow", "no-write"],
  };
}
