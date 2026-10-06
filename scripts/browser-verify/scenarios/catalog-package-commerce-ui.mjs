export default async function packageUiCommerce({ page, capture }) {
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(700);

  const required = [
    "Paket Baru",
    "Foto Paket",
    "Isi Paket",
    "Harga Paket",
    "Informasi Tambahan",
    "Simpan Paket",
    "Tambah Barang",
  ];

  for (const label of required) {
    const target = page.getByText(label, { exact: true }).first();
    if (!(await target.count()) || !(await target.isVisible().catch(() => false))) {
      throw new Error("UI paket tidak menampilkan: " + label + " BODY=" + (await page.locator("body").innerText()).slice(0, 3500));
    }
  }

  const packageNameInput = page.getByRole("textbox", { name: /Nama Paket/ }).first();
  if (!(await packageNameInput.count()) || !(await packageNameInput.isVisible().catch(() => false))) {
    throw new Error("Input Nama Paket tidak terlihat.");
  }

  if (!(await page.getByRole("textbox", { name: "Durasi tarif" }).isVisible().catch(() => false))) {
    throw new Error("Input durasi tarif paket tidak terlihat.");
  }
  if (!(await page.getByRole("combobox", { name: "Satuan tarif" }).isVisible().catch(() => false))) {
    throw new Error("Pemilihan satuan tarif paket tidak terlihat.");
  }

  const stickySave = page.getByRole("button", { name: "Simpan Paket", exact: true });
  const headerSave = page.locator("header button").filter({ hasText: "Simpan" }).first();
  if (await stickySave.isDisabled() || await headerSave.isDisabled()) {
    throw new Error("Tombol Simpan masih nonaktif pada form paket baru.");
  }

  await packageNameInput.fill("Uji Paket Simpan");
  await page.getByRole("textbox", { name: "Harga Paket", exact: true }).fill("500000");
  if (await stickySave.isDisabled() || await headerSave.isDisabled()) {
    throw new Error("Tombol Simpan tetap nonaktif setelah nama dan harga paket diisi.");
  }

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error("Horizontal overflow pada halaman paket.");
  }

  await page.getByRole("button", { name: "Tambah Barang", exact: true }).click();

  const pickerTitle = page.getByRole("heading", { name: "Tambah Barang ke Paket", exact: true });
  await pickerTitle.waitFor({ state: "visible", timeout: 5000 });
  await page.getByPlaceholder("Cari barang, kategori, atau varian...").waitFor({ state: "visible", timeout: 5000 });

  try {
    await page.getByRole("button", { name: "Produk", exact: true }).waitFor({ state: "visible", timeout: 5000 });
  } catch (error) {
    throw new Error("Filter Produk tidak terlihat. BODY=" + (await page.locator("body").innerText()).slice(0, 5000));
  }
  await page.getByRole("button", { name: "Varian", exact: true }).waitFor({ state: "visible", timeout: 5000 });
  await page.getByRole("button", { name: "Semua kategori", exact: true }).waitFor({ state: "visible", timeout: 5000 });

  const pickerBody = await page.locator("body").innerText();
  if (/Tarif belum tersedia|Ready:\s*\d+|Ready stock:/i.test(pickerBody)) {
    throw new Error("Picker paket masih menampilkan harga atau stok produk.");
  }

  const plusButtons = page.getByRole("button", { name: "Tambah jumlah", exact: true });
  if (!(await plusButtons.count())) {
    throw new Error("Picker tidak memiliki kontrol jumlah +.");
  }

  await plusButtons.first().click();
  await page.waitForTimeout(250);

  if (!(await pickerTitle.isVisible().catch(() => false))) {
    throw new Error("Menambah jumlah membuka sheet kedua atau menutup picker.");
  }

  const cartText = await page.locator("body").innerText();
  if (!/Keranjang sementara\s+1 item · 1 unit/i.test(cartText)) {
    throw new Error("Keranjang sementara tidak mencatat 1 item · 1 unit.");
  }

  await page.getByRole("button", { name: "Varian", exact: true }).click();
  const variantRows = page.getByRole("button", { name: "Tambah jumlah", exact: true });
  if (!(await variantRows.count())) {
    const body = await page.locator("body").innerText();
    if (!/Tidak ada varian yang cocok/i.test(body)) {
      throw new Error("Filter Varian tidak menghasilkan state yang dapat dipahami.");
    }
  }

  await page.getByRole("button", { name: "Selesai", exact: true }).click();
  await pickerTitle.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

  const mainBody = await page.locator("body").innerText();
  if (!/1 barang/i.test(mainBody)) {
    throw new Error("Cart belum dipindahkan ke draft Isi Paket setelah Selesai.");
  }

  await page.getByText("Informasi Tambahan", { exact: true }).click();
  if (!(await page.locator("textarea").count())) {
    throw new Error("Accordion Informasi Tambahan tidak membuka field tambahan.");
  }

  await capture("package-ui-commerce");
  return {
    state: "VERIFIED",
    overflow,
    picker: true,
    categoryFilter: true,
    productVariantFilter: true,
    inlineQuantity: true,
    temporaryCart: true,
    noSecondSheet: true,
    noProductPricingOrStock: true,
    additionalInfoAccordion: true,
    stickySave: true,
  };
}
