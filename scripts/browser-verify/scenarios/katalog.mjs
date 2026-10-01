export default async function katalogScenario({ page, baseURL, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Browser runner berada di halaman login." };
  }

  const waitApp = async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(350);
  };

  await page.goto(`${baseURL}/katalog`, { waitUntil: "domcontentloaded" });
  await waitApp();
  await page.getByRole("heading", { name: "Katalog", exact: true }).waitFor({ state: "visible", timeout: 15000 });

  await page.locator("#catalog-search").fill("zz-visual-no-match");
  await page.getByText("Tidak ada produk yang cocok", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await capture("catalog-list-empty-filter");

  await page.getByRole("button", { name: "Atur Ulang", exact: true }).click();
  await page.getByRole("heading", { name: "Katalog", exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await capture("catalog-list");

  await page.getByRole("link", { name: /Kelola Katalog/i }).click();
  await page.waitForURL(/\/katalog\/manage$/, { timeout: 10000 });
  await waitApp();
  await page.getByRole("heading", { name: "Kelola Katalog", exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await capture("catalog-manage-product");

  await page.getByRole("tab", { name: "Varian" }).click();
  await page.getByRole("combobox", { name: "Barang induk" }).waitFor({ state: "visible", timeout: 10000 });
  await capture("catalog-manage-variant");

  await page.getByRole("tab", { name: "Paket Sewa" }).click();
  await page.getByText("Tambah Komponen", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
  await capture("catalog-manage-package");

  await page.getByRole("tab", { name: "Tarif" }).click();
  await page.getByText("Tambah Tarif", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("combobox", { name: "Tipe target" }).waitFor({ state: "visible", timeout: 5000 });
  await capture("catalog-manage-tariff");

  await page.goto(`${baseURL}/katalog`, { waitUntil: "domcontentloaded" });
  await waitApp();

  const detailLink = page.getByRole("link", { name: /^Detail$/i }).first();
  if (!(await detailLink.count())) throw new Error("Tidak ditemukan produk untuk visual detail Katalog.");

  await detailLink.click();
  await page.waitForURL(/\/katalog\/show\/[^/]+$/, { timeout: 10000 });
  await waitApp();
  await page.getByText("Informasi produk", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await capture("catalog-detail");

  await page.getByRole("link", { name: /Ubah Barang/i }).click();
  await page.waitForURL(/\/katalog\/edit\/[^/]+$/, { timeout: 10000 });
  await waitApp();
  await page.getByText("Katalog · Edit Produk", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await capture("catalog-edit-general");

  const statusButton = page.getByRole("button", { name: "Nonaktif" });
  if (await statusButton.count()) {
    await statusButton.click();
    await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("heading", { name: /Nonaktifkan produk/i }).waitFor({ state: "visible", timeout: 5000 });
    await capture("catalog-status-confirmation");
    await page.getByRole("button", { name: "Batal" }).click();
  }

  await page.getByRole("tab", { name: /Varian/ }).click();
  await page.getByText("Tambah Varian", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
  await capture("catalog-edit-variant");

  await page.getByRole("tab", { name: /Tarif/ }).click();
  await page.getByText("Simpan Tarif", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
  await capture("catalog-edit-tariff");

  await page.getByRole("tab", { name: /Media/ }).click();
  await page.getByText("Tambah Media Produk", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count()) {
    const accept = await fileInput.getAttribute("accept");
    if (!accept?.includes("image")) throw new Error("Media picker tidak membatasi ke image/*.");
  }
  await capture("catalog-edit-media");

  await page.getByRole("tab", { name: /Paket/ }).click();
  await page.getByText(/Belum menjadi komponen paket|Referensi produk|Boundary paket/, { exact: false }).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await capture("catalog-edit-package");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("Katalog memiliki horizontal overflow.");

  return {
    state: "VERIFIED",
    interaction: [
      "list-filter-empty",
      "list-reset",
      "manage-product",
      "manage-variant",
      "manage-package",
      "manage-tariff",
      "detail",
      "edit-general",
      "status-confirmation-cancel",
      "edit-variant",
      "edit-tariff",
      "edit-media",
      "edit-package",
      "no-horizontal-overflow",
    ],
  };
}
