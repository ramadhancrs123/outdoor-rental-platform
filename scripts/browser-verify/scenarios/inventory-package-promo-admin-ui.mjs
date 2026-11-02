export default async function inventoryPackagePromoAdminUi({ page, capture }) {
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
  await page.getByText("Paket", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });

  const packageCard = page.locator("main").getByText("Paket camping 2 orang", { exact: true }).first();
  await packageCard.waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Promo", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 });
  await page.getByText("65.000", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".line-through").filter({ hasText: "80.000" }).first().waitFor({ state: "visible", timeout: 5000 });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflow) throw new Error("Kartu inventaris paket promo menimbulkan horizontal overflow.");

  await capture("inventory-package-promo");
  if (promoReads < 1) throw new Error("Inventaris tidak membaca data promo aktif.");
  if (writeAttempts > 0) throw new Error("Skenario inventaris seharusnya hanya membaca data.");

  return {
    state: "VERIFIED",
    packageName: await packageCard.innerText(),
    promoVisible: true,
    effectivePriceVisible: true,
    promoReadRequests: promoReads,
    writeAttempts,
    checks: ["package-inventory-read", "promo-badge", "effective-price", "normal-price-strikethrough", "no-overflow", "no-write"],
  };
}
