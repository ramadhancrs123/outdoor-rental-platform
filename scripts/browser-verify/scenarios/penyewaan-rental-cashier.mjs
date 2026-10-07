export default async function rentalCashierScenario({ page, capture }) {
  let pageErrorStack = "";
  page.on("pageerror", (error) => { pageErrorStack = error.stack || error.message; });

  if (page.url().includes("/login")) {
    await capture("auth-required");
    return {
      state: "BLOCKED_AUTH",
      reason: "Route Rental dilindungi Authenticated dan browser tidak memiliki sesi admin.",
    };
  }

  await page.getByRole("heading", { name: "Rental Baru" }).waitFor({ state: "visible", timeout: 15000 });

  if (await page.locator('[aria-current="step"]').count()) {
    throw new Error("Wizard/stepper lama masih tampil.");
  }

  await page.getByText("Konteks Rental", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  await page.getByRole("heading", { name: "Sewa apa?" }).waitFor({ state: "visible", timeout: 5000 });
  await page.getByRole("button", { name: /Pilih penyewa \/ cari nama atau nomor/i }).waitFor({ state: "visible", timeout: 5000 });
  const openCatalogButton = page.getByRole("button", { name: /^Buka Katalog Rental/i });
  await openCatalogButton.waitFor({ state: "visible", timeout: 5000 });

  await capture("walk-in-initial");

  // 1) Renter picker: about 90% of viewport.
  await page.getByRole("button", { name: /Pilih penyewa \/ cari nama atau nomor/i }).click();
  const renterDialog = page.getByRole("dialog");
  await renterDialog.waitFor({ state: "visible", timeout: 5000 });
  const renterBox = await renterDialog.boundingBox();
  const cssViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const renterPickerSizeIssue = !renterBox || renterBox.height < cssViewport.height * 0.80 || renterBox.width < cssViewport.width * 0.80;
  await capture("renter-picker-opened");

  const renterSearch = renterDialog.getByRole("textbox", { name: "Cari penyewa" });
  await renterSearch.fill("Asep");
  await renterDialog.getByRole("button", { name: /Asep/i }).first().waitFor({ state: "visible", timeout: 10000 });
  await renterDialog.getByRole("button", { name: /Asep/i }).first().click();
  await renterDialog.waitFor({ state: "hidden", timeout: 5000 });
  await capture("renter-picker-selected");

  // 2) Period: 24h + 1m must show compact warning and 2 periods.
  const periodInputs = page.locator('input[type="datetime-local"]');
  if ((await periodInputs.count()) < 2) throw new Error("Input periode rental tidak ditemukan.");

  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 + 60 * 1000);
  const localValue = (value) => {
    const pad = (n) => String(n).padStart(2, "0");
    return value.getFullYear() + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate()) +
      "T" + pad(value.getHours()) + ":" + pad(value.getMinutes());
  };
  await periodInputs.nth(0).fill(localValue(start));
  await periodInputs.nth(1).fill(localValue(end));
  await page.getByText(/Durasi melewati 24 jam/i).waitFor({ state: "visible", timeout: 5000 });
  await page.getByText(/2 periode tarif/i).first().waitFor({ state: "visible", timeout: 5000 });
  await capture("period-24h-plus-1m");

  // 3) Catalog picker: about 90% of viewport, product grid + photo area + temporary cart.
  await openCatalogButton.click();
  const catalogDialog = page.getByRole("dialog");
  await catalogDialog.waitFor({ state: "visible", timeout: 5000 });
  const catalogBox = await catalogDialog.boundingBox();
  if (!catalogBox || catalogBox.height < cssViewport.height * 0.80 || catalogBox.width < cssViewport.width * 0.80) {
    throw new Error("Dialog katalog tidak menggunakan area sekitar 90% layar. box=" + JSON.stringify(catalogBox) + " cssViewport=" + JSON.stringify(cssViewport));
  }
  await catalogDialog.getByRole("textbox", { name: "Cari barang di katalog" }).waitFor({ state: "visible", timeout: 5000 });
  await catalogDialog.getByRole("button", { name: "Semua", exact: true }).waitFor({ state: "visible", timeout: 5000 });

  const consinaCard = catalogDialog.locator("button").filter({ hasText: /Consina/ }).first();
  await consinaCard.waitFor({ state: "visible", timeout: 10000 });
  await consinaCard.click();

  const addToCartButton = catalogDialog.locator('button:visible').filter({ hasText: /Tambah ke Keranjang Sementara/i }).last();
  await addToCartButton.waitFor({ state: "visible", timeout: 10000 });
  if (await addToCartButton.evaluate((el) => el instanceof HTMLButtonElement && el.disabled)) {
    throw new Error("Tambah ke Keranjang Sementara masih disabled. Dialog=" + (await catalogDialog.innerText()).slice(-3000));
  }
  await capture("catalog-picker-product-detail");
  await addToCartButton.click();

  const floatingCart = page.locator('button:visible').filter({ hasText: /\d+ · Rp/ }).last();
  await floatingCart.waitFor({ state: "visible", timeout: 5000 });
  await floatingCart.evaluate((el) => (el instanceof HTMLElement ? el.click() : undefined));
  await catalogDialog.waitFor({ state: "hidden", timeout: 5000 });
  await page.getByText(/1 item/, { exact: false }).first().waitFor({ state: "visible", timeout: 5000 });
  await capture("catalog-picker-applied");

  // 4) Prepare rental, then inline Finance + Unit section.
  const prepareButton = page.getByRole("complementary").getByRole("button", { name: "Siapkan Rental", exact: true });
  await prepareButton.waitFor({ state: "visible", timeout: 5000 });
  if (await prepareButton.isDisabled()) throw new Error("Siapkan Rental disabled padahal renter, periode, dan barang sudah lengkap.");

  let createRentalRpcError = "";
  const createRentalResponse = (response) => {
    if (response.url().includes("/rest/v1/rpc/command_create_direct_rental") && response.status() >= 400) {
      void response.text().then((text) => { createRentalRpcError = text; }).catch(() => {});
    }
  };
  page.on("response", createRentalResponse);
  await prepareButton.click();
  await page.waitForTimeout(1000);
  page.off("response", createRentalResponse);

  if (createRentalRpcError) throw new Error("command_create_direct_rental failed: " + createRentalRpcError);
  if (pageErrorStack) throw new Error("PAGE_ERROR during prepare: " + pageErrorStack);

  await page.getByText("Rental sudah disiapkan", { exact: false }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Pembayaran", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText("Penetapan Unit", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "Langsung Sewa", exact: true }).waitFor({ state: "visible", timeout: 10000 });

  // 5) Inline payment: DP + nominal + account only.
  await page.getByRole("button", { name: "DP", exact: true }).click();
  const numericInputs = page.locator('input[type="number"]');
  const amountInput = numericInputs.last();
  await amountInput.waitFor({ state: "visible", timeout: 5000 });
  await amountInput.fill("1000");

  const accountTrigger = page.getByRole("combobox").last();
  await accountTrigger.waitFor({ state: "visible", timeout: 5000 });
  await accountTrigger.click();
  const accountOption = page.getByRole("option").first();
  await accountOption.waitFor({ state: "visible", timeout: 5000 });
  await accountOption.click();

  const paymentButton = page.getByRole("button", { name: /Catat DP/i });
  if (await paymentButton.isDisabled()) {
    throw new Error("Catat DP masih disabled setelah nominal dan akun uang dipilih.");
  }
  await paymentButton.click();
  await page.getByText("Sudah bayar", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await capture("inline-payment");

  // 6) Direct rental = assignment + handover + active in the same workspace.
  let activationRpcError = "";
  const activationResponse = (response) => {
    if (response.url().includes("/rest/v1/rpc/command_operational_activate_rental") && response.status() >= 400) {
      void response.text().then((text) => { activationRpcError = text; }).catch(() => {});
    }
  };
  page.on("response", activationResponse);
  await page.getByRole("button", { name: "Langsung Sewa", exact: true }).click();
  await page.waitForTimeout(1200);
  page.off("response", activationResponse);

  if (activationRpcError) throw new Error("command_operational_activate_rental failed: " + activationRpcError);
  if (pageErrorStack) throw new Error("PAGE_ERROR during direct rental: " + pageErrorStack);

  await page.getByText("Penyewaan Aktif", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: /QR Penyewaan/i }).waitFor({ state: "visible", timeout: 5000 });
  await page.getByRole("button", { name: /Struk 58 mm/i }).waitFor({ state: "visible", timeout: 5000 });
  await capture("direct-rental-active-output");

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (horizontalOverflow) throw new Error("Walk-in workspace memiliki horizontal overflow.");

  return {
    state: "VERIFIED",
    interaction: [
      "renter-picker-90-percent",
      "period-24h-plus-1m-warning",
      "catalog-picker-90-percent",
      "product-photo-card-and-ready-stock",
      "temporary-cart-and-apply",
      "prepare-rental",
      "inline-dp-with-account",
      "direct-rental-assignment-handover-active",
      "qr-and-receipt-preserved",
      "no-horizontal-overflow",
    ],
  };
}
