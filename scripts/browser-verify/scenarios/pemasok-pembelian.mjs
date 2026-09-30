export default async function pemasokPembelianScenario({ page, baseURL, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Route procurement memerlukan sesi admin." };
  }

  const supplierFixture = [
    {
      pemasok_id: "visual-supplier-001",
      usaha_id: "usaha-visual",
      nama: "PT Outdoor Sejahtera",
      nomor_telepon: "0822 3344 5566",
      email: "outdoor@sejahtera.co.id",
      alamat: "Jl. Gunung Merbabu No. 22, Bandung, Jawa Barat",
      catatan: "Pemasok utama untuk tenda dan aksesoris.",
      status: "active",
      updated_at: "2026-09-29T08:40:00Z",
    },
    {
      pemasok_id: "visual-supplier-002",
      usaha_id: "usaha-visual",
      nama: "CV Alam Lestari",
      nomor_telepon: "0813 7766 8899",
      email: "alam@lestari.co.id",
      alamat: "Jl. Cikuray No. 5, Garut",
      catatan: null,
      status: "active",
      updated_at: "2026-09-29T08:42:00Z",
    },
    {
      pemasok_id: "visual-supplier-003",
      usaha_id: "usaha-visual",
      nama: "Toko Gunung Jaya",
      nomor_telepon: "0812 9988 7766",
      email: "gunung@jaya.co.id",
      alamat: "Jl. Raya Cikajang No. 11, Garut",
      catatan: null,
      status: "inactive",
      updated_at: "2026-09-29T08:43:00Z",
    },
  ];

  const purchaseFixture = [
    {
      pembelian_id: "visual-purchase-001",
      usaha_id: "usaha-visual",
      pemasok_id: "visual-supplier-001",
      nomor_pembelian: "PB-2026-004",
      tanggal_pembelian: "2026-09-29",
      status: "draft",
      total_amount: "400000",
      currency_code: "IDR",
      catatan: "Pembelian stok awal bulan.",
      updated_at: "2026-09-29T08:45:00Z",
    },
    {
      pembelian_id: "visual-purchase-002",
      usaha_id: "usaha-visual",
      pemasok_id: "visual-supplier-002",
      nomor_pembelian: "PB-2026-003",
      tanggal_pembelian: "2026-09-28",
      status: "draft",
      total_amount: "725000",
      currency_code: "IDR",
      catatan: null,
      updated_at: "2026-09-28T09:20:00Z",
    },
  ];

  const lineFixture = [{
    detail_pembelian_id: "visual-line-001",
    usaha_id: "usaha-visual",
    pembelian_id: "visual-purchase-001",
    barang_id: "visual-product-001",
    varian_barang_id: "visual-variant-001",
    deskripsi: "Tenda Dome 4P",
    jumlah: 2,
    unit_price: 125000,
    subtotal: 250000,
    created_at: "2026-09-29T08:45:00Z",
    updated_at: "2026-09-29T08:45:00Z",
  }, {
    detail_pembelian_id: "visual-line-002",
    usaha_id: "usaha-visual",
    pembelian_id: "visual-purchase-001",
    barang_id: "visual-product-002",
    varian_barang_id: "visual-variant-002",
    deskripsi: "Kompor Portable",
    jumlah: 1,
    unit_price: 150000,
    subtotal: 150000,
    created_at: "2026-09-29T08:45:00Z",
    updated_at: "2026-09-29T08:45:00Z",
  }];

  const productFixture = [
    { barang_id: "visual-product-001", usaha_id: "usaha-visual", nama: "Tenda Dome - Eiger 4P", slug: "tenda-dome-eiger-4p", status: "active" },
    { barang_id: "visual-product-002", usaha_id: "usaha-visual", nama: "Kompor Portable", slug: "kompor-portable", status: "active" },
  ];
  const variantFixture = [
    { varian_barang_id: "visual-variant-001", barang_id: "visual-product-001", usaha_id: "usaha-visual", nama: "Standard", status: "active" },
    { varian_barang_id: "visual-variant-002", barang_id: "visual-product-002", usaha_id: "usaha-visual", nama: "Single", status: "active" },
  ];

  const waitApp = async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(300);
  };

  const visible = async (locator, timeout = 12000) => {
    await locator.waitFor({ state: "visible", timeout });
    return locator;
  };

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split("/").pop();
    const supplierSingle = Boolean(url.searchParams.get("pemasok_id")?.includes("eq.visual-supplier-001"));
    const purchaseSingle = Boolean(url.searchParams.get("pembelian_id")?.includes("eq.visual-purchase-001"));

    let body = null;
    if (table === "pemasok") body = supplierSingle ? supplierFixture[0] : supplierFixture;
    if (table === "pembelian") body = purchaseSingle ? purchaseFixture[0] : purchaseFixture;
    if (table === "detail_pembelian") body = lineFixture;
    if (table === "barang") body = productFixture;
    if (table === "varian_barang") body = variantFixture;

    if (body !== null) {
      await route.fulfill({ status: 200, contentType: "application/json", headers: table === "pemasok" || table === "pembelian" ? { "content-range": `0-${Math.max(0, (Array.isArray(body) ? body.length : 1) - 1)}/${Array.isArray(body) ? body.length : 1}` } : {}, body: JSON.stringify(body) });
      return;
    }
    await route.continue();
  });

  await page.route("**/rest/v1/rpc/command_create_supplier", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...supplierFixture[0], pemasok_id: "visual-supplier-created" }),
    });
  });

  await page.route("**/rest/v1/rpc/command_create_purchase", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...purchaseFixture[0],
        pembelian_id: "visual-purchase-created",
        updated_at: "2026-09-29T08:45:00Z",
      }),
    });
  });

  await page.goto(`${baseURL}/pemasok`, { waitUntil: "domcontentloaded" });
  await waitApp();
  await visible(page.getByRole("heading", { level: 1, name: "Pemasok", exact: true }));
  await visible(page.locator('a[href="/pemasok/create"]').first());
  await visible(page.getByRole("tab", { name: "Semua", exact: true }));
  await visible(page.getByRole("tab", { name: "Aktif", exact: true }));
  await visible(page.getByRole("tab", { name: "Tidak Aktif", exact: true }));
  await capture("supplier-list");

  await page.locator('a[href="/pemasok/create"]').first().click();
  await page.waitForURL(/\/pemasok\/create$/, { timeout: 10000 });
  await waitApp();
  await page.getByLabel("Nama Pemasok").fill("PT Outdoor Sejahtera");
  await page.getByLabel("Telepon").fill("0822 3344 5566");
  await page.getByLabel("Email").fill("outdoor@sejahtera.co.id");
  await page.getByLabel("Alamat").fill("Jl. Gunung Merbabu No. 22, Bandung, Jawa Barat");
  await page.getByLabel("Catatan (Opsional)").fill("Pemasok utama untuk tenda dan aksesoris.");
  await capture("supplier-create");
  await page.getByRole("button", { name: /Lanjut ke Tinjau/i }).click();
  await visible(page.getByText("Tinjau Data Pemasok", { exact: true }));
  await capture("supplier-review");
  await page.getByRole("button", { name: /Simpan Pemasok/i }).click();
  await visible(page.getByRole("heading", { name: "Pemasok Berhasil Dibuat", exact: true }));
  await capture("supplier-success");

  await page.goto(`${baseURL}/pemasok/visual-supplier-001`, { waitUntil: "domcontentloaded" });
  await waitApp();
  await visible(page.getByRole("heading", { level: 1, name: "PT Outdoor Sejahtera", exact: true }));
  await visible(page.getByRole("tab", { name: "Informasi", exact: true }));
  await visible(page.getByRole("tab", { name: "Riwayat Pembelian", exact: true }));
  await capture("supplier-detail-info");
  await page.getByRole("tab", { name: "Riwayat Pembelian", exact: true }).click();
  await visible(page.getByText("PB-2026-004", { exact: true }));
  await capture("supplier-purchase-history");
  await page.getByRole("tab", { name: "Informasi", exact: true }).click();
  await page.getByRole("button", { name: /Nonaktifkan Pemasok/i }).click();
  await visible(page.getByRole("dialog"));
  await visible(page.getByRole("heading", { name: /Nonaktifkan Pemasok/i }));
  await capture("supplier-deactivate-confirmation");
  await page.getByRole("button", { name: "Batal", exact: true }).click();

  await page.goto(`${baseURL}/pembelian`, { waitUntil: "domcontentloaded" });
  await waitApp();
  await visible(page.getByRole("heading", { level: 1, name: "Pembelian", exact: true }));
  await visible(page.locator('a[href="/pembelian/create"]').first());
  await capture("purchase-list");

  await page.locator('a[href="/pembelian/create"]').first().click();
  await page.waitForURL(/\/pembelian\/create$/, { timeout: 10000 });
  await waitApp();
  await visible(page.getByRole("heading", { level: 1, name: "Buat Draft Pembelian", exact: true }));
  await page.getByLabel(/Nomor Pembelian/).fill("PB-2026-004");
  await page.getByLabel(/Tanggal Pembelian/).fill("2026-09-29");
  const supplierCombo = page.getByRole("combobox").first();
  await supplierCombo.click();
  await visible(page.getByRole("option", { name: "PT Outdoor Sejahtera", exact: true }));
  await page.getByRole("option", { name: "PT Outdoor Sejahtera", exact: true }).click();
  await capture("purchase-create-header");

  const itemCard = page.locator('[data-slot="card"]').filter({ hasText: "Item 1" }).first();
  const itemProductCombo = itemCard.getByRole("combobox").first();
  await itemProductCombo.click();
  await visible(page.getByRole("option", { name: "Tenda Dome - Eiger 4P", exact: true }));
  await page.getByRole("option", { name: "Tenda Dome - Eiger 4P", exact: true }).click();
  const itemVariantCombo = itemCard.getByRole("combobox").nth(1);
  await itemVariantCombo.click();
  await visible(page.getByRole("option", { name: "Standard", exact: true }));
  await page.getByRole("option", { name: "Standard", exact: true }).click();
  await itemCard.getByLabel("Tambah jumlah").click();
  await itemCard.getByLabel("Harga Beli / Unit").fill("125000");
  await capture("purchase-create-item");

  await visible(page.getByText("Total (Preview)", { exact: true }));
  await capture("purchase-create-summary");
  await page.getByRole("button", { name: /Tambah Item/i }).click();
  await visible(page.getByText("Item 2", { exact: true }));
  const secondItemCard = page.getByText("Item 2", { exact: true }).locator("xpath=ancestor::div[@data-slot='card'][1]");
  const secondProductCombo = secondItemCard.getByRole("combobox").first();
  await secondProductCombo.click();
  await visible(page.getByRole("option", { name: "Kompor Portable", exact: true }));
  await page.getByRole("option", { name: "Kompor Portable", exact: true }).click();
  const secondVariantCombo = secondItemCard.getByRole("combobox").nth(1);
  await secondVariantCombo.click();
  await visible(page.getByRole("option", { name: "Single", exact: true }));
  await page.getByRole("option", { name: "Single", exact: true }).click();
  await secondItemCard.getByLabel("Harga Beli / Unit").fill("150000");
  await capture("purchase-create-multiple-items");

  await visible(page.getByRole("button", { name: /Lanjut ke Tinjau/i }));
  await page.getByRole("button", { name: /Lanjut ke Tinjau/i }).click();
  await visible(page.getByText("Tinjau Draft Pembelian", { exact: true }));
  await visible(page.getByRole("button", { name: /Simpan Draft/i }));
  await capture("purchase-review");
  await page.getByRole("button", { name: /Simpan Draft/i }).click();
  await visible(page.getByRole("heading", { name: "Draft Pembelian Dibuat", exact: true }));
  await capture("purchase-success");

  await page.goto(`${baseURL}/pembelian/visual-purchase-001`, { waitUntil: "domcontentloaded" });
  await waitApp();
  await visible(page.getByRole("heading", { level: 1, name: "PB-2026-004", exact: true }));
  await visible(page.getByRole("tab", { name: "Ringkasan", exact: true }));
  await capture("purchase-detail-summary");
  await page.getByRole("tab", { name: "Item", exact: true }).click();
  const detailItemName = page.locator("tbody").getByText("Tenda Dome - Eiger 4P", { exact: true }).first();
  if (await detailItemName.isVisible().catch(() => false)) {
    await visible(detailItemName);
  } else {
    await visible(page.getByText("Tenda Dome - Eiger 4P", { exact: true }).first());
  }
  await capture("purchase-detail-items");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("Procurement mobile UI memiliki horizontal overflow.");

  return {
    state: "VERIFIED",
    interaction: [
      "supplier-list",
      "supplier-create",
      "supplier-review",
      "supplier-success",
      "supplier-detail-info",
      "supplier-history",
      "supplier-deactivate-confirmation",
      "purchase-list",
      "purchase-create-header",
      "purchase-create-item",
      "purchase-create-summary",
      "purchase-create-multiple-items",
      "purchase-review",
      "purchase-success",
      "purchase-detail-summary",
      "purchase-detail-items",
      "no-horizontal-overflow",
    ],
    mutationCommitted: false,
    note: "All mutation screens use browser-only RPC stubs; REST read-side uses deterministic visual fixtures. No synthetic procurement record is committed to Supabase.",
  };
}
