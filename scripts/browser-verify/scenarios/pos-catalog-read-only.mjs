export default async function posCatalogReadOnly({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "POS membutuhkan sesi admin terautentikasi." };
  }

  await page.getByRole("heading", { name: "Penjualan", exact: true })
    .waitFor({ state: "visible", timeout: 15000 });
  await page.getByPlaceholder("Cari produk atau kategori…")
    .waitFor({ state: "visible", timeout: 10000 });

  const body = await page.locator("body").innerText();
  if (!body.includes("Jas Hujan")) {
    throw new Error("Katalog POS tidak menampilkan produk aktual Jas Hujan.");
  }
  if (!body.includes("Rp")) {
    throw new Error("Harga jual katalog POS tidak terlihat.");
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  if (overflow) throw new Error("POS mengalami horizontal overflow pada viewport ini.");

  await capture("pos-catalog-live-items");

  const addButton = page.getByRole("button", { name: "Tambah ke keranjang", exact: true }).first();
  await addButton.waitFor({ state: "visible", timeout: 10000 });
  if (await addButton.isDisabled()) {
    throw new Error("Produk dengan stok/harga valid tidak dapat ditambahkan ke keranjang.");
  }
  await addButton.click();

  const cartButton = page.getByRole("button", { name: /Periksa Keranjang/ });
  await cartButton.waitFor({ state: "visible", timeout: 5000 });
  await capture("pos-cart-before-checkout");

  await cartButton.click();
  await page.getByRole("heading", { name: "Verifikasi Penjualan", exact: true })
    .waitFor({ state: "visible", timeout: 5000 });
  await capture("pos-checkout-review-no-submit");

  return {
    state: "VERIFIED",
    checks: [
      "authenticated-pos-route",
      "real-catalog-item-and-price-rendered",
      "responsive-layout",
      "product-adds-to-cart",
      "checkout-review-opens-without-submitting-or-writing-data"
    ]
  };
}
