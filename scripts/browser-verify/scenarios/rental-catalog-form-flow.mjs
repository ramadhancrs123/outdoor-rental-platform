export default async function rentalCatalogFormFlow({ page, capture }) {
  await page.getByRole("heading", { name: "Rental Baru" }).waitFor({ state: "visible", timeout: 20000 });

  const dateInputs = page.locator('input[type="datetime-local"]');
  await dateInputs.nth(0).fill("2026-11-06T09:00");
  await dateInputs.nth(1).fill("2026-11-07T09:00");

  const initialDates = await dateInputs.evaluateAll((items) => items.map((item) => item.value));
  if (initialDates[0] !== "2026-11-06T09:00" || initialDates[1] !== "2026-11-07T09:00") {
    throw new Error("Periode rental tidak tersimpan sebelum membuka katalog: " + JSON.stringify(initialDates));
  }

  await capture("rental-form-before-catalog");
  await page.getByRole("button", { name: /Buka Katalog/ }).click();
  await page.getByRole("heading", { name: "Katalog Rental" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Tripod/ }).first().click();

  const addRentalLine = page.getByRole("button", { name: /Tambah ke Keranjang Sementara/ });
  await addRentalLine.waitFor({ state: "visible", timeout: 15000 });
  const stickyActions = page.getByTestId("catalog-sticky-actions");
  await stickyActions.waitFor({ state: "visible" });
  const stickyBottomBeforeScroll = await stickyActions.evaluate((node) => node.getBoundingClientRect().bottom);
  await page.locator("main.relative .overflow-y-auto").first().evaluate((node) => { node.scrollTop = node.scrollHeight; });
  const stickyBottomAfterScroll = await stickyActions.evaluate((node) => node.getBoundingClientRect().bottom);
  const stickyViewportBottom = await page.evaluate(() => window.innerHeight);
  if (Math.abs(stickyBottomBeforeScroll - stickyBottomAfterScroll) > 2 || stickyBottomAfterScroll > stickyViewportBottom) {
    throw new Error("Sticky catalogue actions moved outside the viewport while scrolling.");
  }
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll("button")];
    const add = buttons.find((button) => button.innerText.includes("Tambah ke Keranjang Sementara"));
    return Boolean(add && !add.disabled);
  }, { timeout: 20000 });
  await addRentalLine.click();
  const itemDialog = page.getByRole("dialog");
  await itemDialog.getByRole("heading", { name: "Atur barang sewa" }).waitFor({ state: "visible" });
  await itemDialog.getByText("Jumlah unit", { exact: true }).waitFor({ state: "visible" });
  await itemDialog.getByText("Perhitungan tarif", { exact: true }).waitFor({ state: "visible" });
  await itemDialog.getByRole("button", { name: "Tambahkan" }).waitFor({ state: "visible" });
  await capture("rental-item-configuration");
  await itemDialog.getByRole("button", { name: "Tambahkan" }).click();

  await page.getByRole("tab", { name: "Barang jual" }).click();
  const saleCategory = page.getByRole("button", { name: "Aksesoris pendukung", exact: true });
  await saleCategory.waitFor({ state: "visible" });
  await saleCategory.click();
  await page.getByText("Jas Hujan", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("button", { name: "Tambah ke pembelian" }).click();

  await page.getByRole("button", { name: "Tinjau keranjang" }).click();
  const reviewDialog = page.getByRole("dialog");
  await reviewDialog.getByRole("heading", { name: "Tinjau pilihan" }).waitFor({ state: "visible" });
  await reviewDialog.getByText("Keranjang sewa", { exact: true }).waitFor({ state: "visible" });
  await reviewDialog.getByText("Tripod", { exact: true }).waitFor({ state: "visible" });
  await reviewDialog.getByText("Jas Hujan", { exact: true }).waitFor({ state: "visible" });
  await reviewDialog.getByText(/Stok \d+/).waitFor({ state: "visible" });
  const purchaseSubtotal = reviewDialog.getByText("Subtotal pembelian", { exact: true });
  await purchaseSubtotal.waitFor({ state: "visible" });
  await reviewDialog.locator('[data-slot="select-value"]:visible').filter({ hasText: "Kas Operasional" }).waitFor({ state: "visible", timeout: 15000 });
  await capture("rental-and-retail-cart-review");

  await reviewDialog.getByRole("button", { name: /Selesai memilih/ }).click();
  await page.getByRole("heading", { name: "Rental Baru" }).waitFor({ state: "visible" });
  await page.getByText(/Tripod/).first().waitFor({ state: "visible" });
  await page.getByText(/Jas Hujan × 1/).waitFor({ state: "visible" });

  const restoredDates = await dateInputs.evaluateAll((items) => items.map((item) => item.value));
  if (JSON.stringify(restoredDates) !== JSON.stringify(initialDates)) {
    throw new Error("Periode rental berubah setelah kembali dari katalog: " + JSON.stringify(restoredDates));
  }
  await capture("rental-form-after-apply");

  // Editing one existing line must seed the full current draft into the picker.
  await page.getByRole("button", { name: "Edit Tripod" }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "Atur barang sewa" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Tutup pengaturan barang" }).click();
  await page.getByText("2 item", { exact: true }).first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Kembali ke formulir rental" }).click();
  await page.getByText(/Tripod/).first().waitFor({ state: "visible" });
  await page.getByText(/Jas Hujan × 1/).waitFor({ state: "visible" });

  await page.getByRole("button", { name: /Buka Katalog/ }).click();
  await page.getByRole("heading", { name: "Katalog Rental" }).waitFor({ state: "visible" });
  await page.getByText("2 item", { exact: true }).first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Tinjau keranjang" }).click();
  await page.getByRole("dialog").getByText("Jas Hujan", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("dialog").getByRole("button", { name: /Selesai memilih/ }).click();
  await capture("reopened-catalog-keeps-both-carts");

  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    catalogWidth: document.querySelector("main.relative")?.getBoundingClientRect().width ?? null,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  if (metrics.horizontalOverflow) throw new Error("Horizontal overflow in rental form flow: " + JSON.stringify(metrics));

  return {
    state: "VERIFIED",
    metrics,
    preservedRentalDates: restoredDates,
    checked: [
      "catalog opens from the Rental Baru form",
      "rental and purchase items use one catalogue page",
      "apply action returns both selections to the rental form",
      "rental period state survives page transition",
      "purchase cart survives closing and reopening the catalogue",
    ],
    noTransactionSubmitted: true,
  };
}
