export default async function rentalCatalogUnified({ page, capture }) {
  await page.getByRole("tab", { name: "Barang sewa" }).waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("button", { name: "Tinjau keranjang" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Jaket Gorpcore/ }).first().waitFor({ state: "visible", timeout: 20000 });

  await page.waitForFunction(() => [...document.querySelectorAll("main.relative img")].some((img) =>
    img.complete && img.naturalWidth > 0
  ), { timeout: 20000 });
  const loadedProductImages = await page.locator("main.relative img").evaluateAll((imgs) =>
    imgs.filter((img) => img.complete && img.naturalWidth > 0).length
  );
  if (!loadedProductImages) throw new Error("Tidak ada foto produk katalog yang berhasil dimuat.");

  // Fast category transitions must not leave a stale empty catalogue.
  const outfitFilter = page.getByRole("button", { name: "Outfit", exact: true }).first();
  if (await outfitFilter.count()) {
    await outfitFilter.click();
    await page.getByRole("button", { name: /Jaket Gorpcore/ }).first().waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Semua", exact: true }).first().click();
    await page.getByRole("button", { name: /Jaket Gorpcore/ }).first().waitFor({ state: "visible" });
  }
  await capture("rental-catalog-products");

  // Selecting a rental product then invoking the sticky action opens its own configuration dialog.
  await page.getByRole("button", { name: /Jaket Gorpcore/ }).first().click();
  const stickyActions = page.getByTestId("catalog-sticky-actions");
  await stickyActions.waitFor({ state: "visible" });
  const openConfig = stickyActions.getByRole("button", { name: /Tambah ke Keranjang Sementara/ });
  await openConfig.waitFor({ state: "visible", timeout: 15000 });
  await openConfig.click();
  const configDialog = page.getByRole("dialog");
  await configDialog.getByRole("heading", { name: "Atur barang sewa" }).waitFor({ state: "visible" });
  const variantSelect = configDialog.getByRole("combobox").first();
  await variantSelect.waitFor({ state: "visible", timeout: 15000 });
  await variantSelect.click();
  const optionText = (await page.getByRole("option").allTextContents()).join(" | ");
  if (!/Hitam \/ M/.test(optionText) || !/Artica Blush \/ M/.test(optionText)) {
    throw new Error("Jaket Gorpcore rental variants were not available in the configuration dialog: " + optionText);
  }
  await page.keyboard.press("Escape");
  await capture("rental-catalog-variant-detail");
  await configDialog.getByRole("button", { name: "Tutup pengaturan barang" }).click();

  // Retail category filters are aligned with the rental/package peer tabs at the top.
  await page.getByRole("tab", { name: "Barang jual" }).click();
  const saleCategory = page.getByRole("button", { name: "Aksesoris pendukung", exact: true });
  await saleCategory.waitFor({ state: "visible" });
  await saleCategory.click();
  await page.getByText("Jas Hujan", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
  await capture("retail-catalog-top-filters");
  const addSaleButton = page.getByRole("button", { name: "Tambah ke pembelian" });
  await addSaleButton.waitFor({ state: "visible" });
  await addSaleButton.click();

  await page.getByRole("button", { name: "Tinjau keranjang" }).click();
  const reviewDialog = page.getByRole("dialog");
  await reviewDialog.getByRole("heading", { name: "Tinjau pilihan" }).waitFor({ state: "visible" });
  await reviewDialog.getByText("Jas Hujan", { exact: true }).waitFor({ state: "visible" });
  await reviewDialog.getByText(/Stok \d+/).waitFor({ state: "visible" });
  await reviewDialog.getByText("Subtotal pembelian", { exact: true }).waitFor({ state: "visible" });
  await reviewDialog.locator('[data-slot="select-value"]:visible').filter({ hasText: "Kas Operasional" }).waitFor({ state: "visible", timeout: 15000 });
  await capture("rental-catalog-cart-review");
  await reviewDialog.getByRole("button", { name: /Selesai memilih/ }).click();

  // Returning to the form and reopening the catalogue must retain the retail cart.
  await page.getByRole("heading", { name: "Rental Baru" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByText(/Jas Hujan × 1/).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: /Buka Katalog/ }).click();
  await page.getByRole("tab", { name: "Barang sewa" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Tinjau keranjang" }).click();
  const reopenedDialog = page.getByRole("dialog");
  await reopenedDialog.getByText("Jas Hujan", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await capture("rental-catalog-retained-cart");
  await reopenedDialog.getByRole("button", { name: /Selesai memilih/ }).click();

  const metrics = await page.evaluate(() => {
    const workspace = document.querySelector("main.relative");
    const rect = workspace?.getBoundingClientRect();
    const header = workspace?.querySelector(":scope > header");
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      loadedProductImages: [...document.querySelectorAll("main.relative img")].filter((img) => img.complete && img.naturalWidth > 0).length,
      pageWidth: rect?.width ?? null,
      pageHeight: rect?.height ?? null,
      pageLeft: rect?.left ?? null,
      pageRight: rect?.right ?? null,
      headerHeight: header?.getBoundingClientRect().height ?? null,
      titleVisible: Boolean(workspace?.querySelector(":scope > header h1")),
      borderWidth: workspace ? getComputedStyle(workspace).borderWidth : null,
      borderRadius: workspace ? getComputedStyle(workspace).borderRadius : null,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  if (metrics.horizontalOverflow) throw new Error("Horizontal overflow in unified rental catalogue: " + JSON.stringify(metrics));
  if (metrics.titleVisible) throw new Error("Judul/copy Katalog Rental masih memakan ruang pada header.");
  if (metrics.borderWidth !== "0px" || metrics.borderRadius !== "0px") {
    throw new Error("Katalog masih terlihat sebagai kartu/dialog terbungkus: " + JSON.stringify(metrics));
  }
  if (metrics.headerHeight != null && metrics.headerHeight > 60) {
    throw new Error("Header katalog belum cukup ringkas: " + JSON.stringify(metrics));
  }

  return {
    state: "VERIFIED",
    metrics,
    checked: [
      "rental catalogue uses a full workspace surface without modal-like border or radius",
      "catalogue title/copy has been removed to free vertical space",
      "rental product images load from valid media records",
      "rapid rental category transitions preserve product results",
      "Jaket Gorpcore variants render inside the item configuration dialog",
      "sticky add action opens item configuration instead of directly adding",
      "retail category filtering is available from the top peer tab row",
      "sticky add/cart action area stays visible",
      "cart icon opens a review dialog with stock and payment details",
      "sale cart survives return to form and reopening catalogue",
    ],
    noTransactionSubmitted: true,
  };
}
