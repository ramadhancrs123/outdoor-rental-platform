export default async function walkInPackagePromoAdminUi({ page, capture }) {
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
  let rentalWrites = 0;
  await page.route("**/rest/v1/promosi_paket_sewa**", async (route) => {
    if (route.request().method() !== "GET") {
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
  page.on("request", (request) => {
    if (request.url().includes("/rest/v1/rpc/command_create_direct_rental")) {
      rentalWrites += 1;
    }
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Pilih penyewa/i }).click();
  const renterDialog = page.getByRole("dialog");
  await renterDialog.waitFor({ state: "visible", timeout: 5000 });
  const renterSearch = renterDialog.getByRole("textbox", { name: "Cari penyewa" });
  await renterSearch.fill("Nurdin");
  const renterChoice = renterDialog.getByRole("button").filter({ hasText: /Nurdin/ }).first();
  await renterChoice.waitFor({ state: "visible", timeout: 10000 });
  await renterChoice.click();

  const periodInputs = page.locator('input[type="datetime-local"]');
  await periodInputs.nth(0).waitFor({ state: "visible", timeout: 5000 });
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(Date.now() + 49 * 60 * 60 * 1000);
  const localValue = (value) => {
    const pad = (n) => String(n).padStart(2, "0");
    return value.getFullYear() + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate()) +
      "T" + pad(value.getHours()) + ":" + pad(value.getMinutes());
  };
  await periodInputs.nth(0).fill(localValue(start));
  await periodInputs.nth(1).fill(localValue(end));

  await page.getByRole("button", { name: /Buka Katalog Rental/i }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "Katalog Rental" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "Paket", exact: true }).click();

  const packageCard = page.getByRole("button").filter({ hasText: "Paket camping 2 orang" }).first();
  await packageCard.waitFor({ state: "visible", timeout: 15000 });
  await packageCard.getByText("Promo", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  await packageCard.getByText("65.000", { exact: false }).waitFor({ state: "visible", timeout: 5000 });
  await packageCard.click();

  if ((page.viewportSize()?.width ?? 1280) < 768) {
    const addPackage = page.getByRole("button", { name: /Tambah Paket ke Keranjang$/i });
    await addPackage.waitFor({ state: "visible", timeout: 10000 });
    for (let attempt = 0; attempt < 40 && await addPackage.isDisabled(); attempt += 1) {
      await page.waitForTimeout(250);
    }
    if (await addPackage.isDisabled()) throw new Error("Promo package is unavailable for cart selection: " + await page.getByRole("dialog").innerText());
    await addPackage.click();
    const pickerSubtotal = page.getByRole("button").filter({ hasText: /1\s*·\s*Rp\s*130\.000/ }).first();
    await pickerSubtotal.waitFor({ state: "visible", timeout: 10000 });
  } else {
    const packagePanel = page.getByText("Perhitungan tarif", { exact: true });
    await packagePanel.waitFor({ state: "visible", timeout: 10000 });
    await page.getByText("Harga normal", { exact: false }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("65.000", { exact: false }).last().waitFor({ state: "visible", timeout: 5000 });
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflow) throw new Error("Picker paket promo menimbulkan horizontal overflow.");

  await capture("walk-in-package-promo");
  if (promoReads < 1) throw new Error("Walk-in tidak membaca promo aktif dari katalog.");
  if (rentalWrites > 0) throw new Error("Skenario pemeriksaan tidak boleh membuat transaksi rental.");

  return {
    state: "VERIFIED",
    renterSelected: true,
    promoPriceVisible: true,
    effectivePriceInCalculation: true,
    promoReadRequests: promoReads,
    rentalWrites,
    checks: ["renter-and-period", "package-card-promo-price", "package-calculation-promo-price", "no-overflow", "no-rental-commit"],
  };
}
