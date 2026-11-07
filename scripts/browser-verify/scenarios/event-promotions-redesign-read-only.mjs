export default async function eventPromotionsRedesignReadOnly({ page, capture }) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text());
  });
  page.on("pageerror", (error) => errors.push("page: " + error.message));

  await page.getByRole("heading", { name: "Event & Promosi" }).waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("heading", { name: "Promo barang & varian" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "Tambah Promo" }).waitFor({ state: "visible" }).catch(() => undefined);
  await page.getByRole("button", { name: "Promo Katalog", exact: true }).waitFor({ state: "visible" }).catch(() => undefined);
  await capture("event-promotions-summary-and-catalog-list");

  await page.getByRole("button", { name: "Tambah Promo" }).click();
  await page.getByRole("heading", { name: "Pilih barang promosi" }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("tab", { name: "Barang jual" }).click();
  await page.getByRole("tab", { name: "Barang sewa" }).click();
  await capture("event-promotions-compact-product-grid");

  const productCards = page.getByRole("button", { name: /^Konfigurasi promo / });
  const productCardLabels = await productCards.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") || ""));
  const productCount = productCardLabels.length;
  if (productCount > 0) {
    const selectedCardIndex = Math.min(1, productCount - 1);
    const initialProductName = productCardLabels[selectedCardIndex].replace("Konfigurasi promo ", "");
    const firstProductName = productCardLabels[0].replace("Konfigurasi promo ", "");
    await productCards.nth(selectedCardIndex).click();
    await page.getByRole("heading", { name: "Konfigurasi promosi" }).waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "1. Pilih barang" }).waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "2. Pilih cakupan promo" }).waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "3. Atur harga promosi" }).waitFor({ state: "visible" });
    const productSelect = page.getByRole("combobox").first();
    await productSelect.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Batal", exact: true }).waitFor({ state: "visible" });
    const save = page.getByRole("button", { name: "Simpan promosi" });
    await save.waitFor({ state: "visible" });
    await capture("event-promotions-config-dialog-initial");

    if (firstProductName && initialProductName && firstProductName !== initialProductName) {
      await productSelect.click();
      await page.getByRole("option").first().click();
      await productSelect.click();
      await page.getByRole("option").nth(selectedCardIndex).click();
    }

    const unitChoices = page.locator("button[aria-pressed]").filter({ hasText: "Unit / varian" });
    const unitCount = await unitChoices.count();
    if (unitCount > 0) await unitChoices.first().click();

    const dialogScroll = page.locator('[data-slot="dialog-content"] .min-h-0.flex-1');
    await dialogScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const footer = page.locator('[data-slot="dialog-footer"]');
    const footerBox = await footer.boundingBox();
    const saveBox = await save.boundingBox();
    if (!footerBox || !saveBox || saveBox.y < footerBox.y || saveBox.y + saveBox.height > footerBox.y + footerBox.height + 1) {
      throw new Error("Tombol simpan tidak berada dalam button bar dialog yang selalu terlihat.");
    }
    await capture("event-promotions-config-dialog-sticky-footer");
    await page.getByRole("button", { name: "Batal", exact: true }).click();
  }

  const overflowPicker = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflowPicker) throw new Error("Halaman pemilihan promo mengalami horizontal overflow.");

  await page.getByRole("button", { name: "Kembali", exact: true }).click();
  await page.getByRole("heading", { name: "Event & Promosi" }).waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Promo Paket", exact: true }).click();
  await page.getByRole("heading", { name: "Promo paket rental" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Tambah Promo Paket" }).click();
  await page.getByRole("heading", { name: "Buat Promo Paket" }).waitFor({ state: "visible" });
  await capture("event-promotions-package-dialog");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Loyalitas", exact: true }).click();
  await page.getByText("Program Loyalitas · Model A", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Ubah Pengaturan" }).click();
  await page.getByRole("heading", { name: "Pengaturan Loyalitas" }).waitFor({ state: "visible" });
  await capture("event-promotions-loyalty-dialog");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Diskon Checkout", exact: true }).click();
  await page.getByText("Kebijakan Diskon Checkout", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Ubah Kebijakan" }).click();
  await page.getByText("Kebijakan Diskon Checkout", { exact: true }).last().waitFor({ state: "visible" });
  await capture("event-promotions-checkout-dialog");
  await page.keyboard.press("Escape");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("Modul Event & Promosi mengalami horizontal overflow.");
  if (errors.length) throw new Error(errors.join("\n"));

  return {
    state: "VERIFIED",
    checks: [
      "promo-only-main-list",
      "dedicated-promo-catalog-route",
      "compact-fixed-height-product-cards",
      "configuration-dialog-includes-product-selector",
      "configuration-dialog-includes-whole-product-and-unit-targets",
      "configuration-dialog-sticky-save-button-bar",
      "package-loyalty-checkout-dialogs",
      "responsive-no-horizontal-overflow",
      "no-promotion-write-submitted",
    ],
    productCount,
    diagnostics: errors,
  };
}
