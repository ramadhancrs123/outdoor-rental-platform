const usahaId = "10000000-0000-4000-8000-000000000099";
const variantId = "10000000-0000-4000-8000-000000000011";
const productRows = Array.from({ length: 13 }, (_, index) => ({
  barang_id: "10000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"),
  usaha_id: usahaId,
  nama: "Carrier " + (index + 1),
  slug: "carrier-" + (index + 1),
  status: "active",
}));

const variantRows = [{
  varian_barang_id: variantId,
  usaha_id: usahaId,
  barang_id: productRows[1].barang_id,
  nama: "45 L",
  kode_internal: "CARRIER-45L",
  deskripsi: "Carrier kapasitas 45 liter.",
  atribut_pembeda: { kapasitas: "45 L" },
  status: "active",
}];

const overviewRows = productRows.map((product, index) => ({
  barang_id: product.barang_id,
  nama: product.nama,
  slug: product.slug,
  status: "active",
  kategori_nama: "Tas & Carrier",
  total_unit: index + 2,
  ready_unit: index + 1,
  rented_unit: 1,
  attention_unit: 0,
  inspection_pending_unit: 0,
  maintenance_unit: 0,
  damaged_unit: 0,
  lost_unit: 0,
  inactive_unit: 0,
  variant_count: index === 1 ? 1 : 0,
  latest_unit_updated_at: "2026-11-01T00:00:00.000Z",
  cover_bucket: null,
  cover_path: null,
}));

export default async function inventoryProductListPagination({ page, baseURL, capture }) {
  if (page.url().includes("/login")) {
    await capture("inventory-list-auth-required");
    return { state: "BLOCKED_AUTH", reason: "Browser runner berada di halaman login." };
  }

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET" && request.method() !== "POST") return route.continue();

    const url = new URL(request.url());
    const table = url.pathname.split("/").pop();

    if (table === "barang") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(productRows),
      });
    }
    if (table === "varian_barang") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(variantRows),
      });
    }
    if (table === "inventory_product_overview") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(overviewRows),
      });
    }
    if (table === "lokasi") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }

    return route.continue();
  });

  await page.goto(baseURL + "/inventaris?mode=products", { waitUntil: "domcontentloaded" });
  await page.getByText("Menampilkan 1–12 dari 13 barang", { exact: true }).waitFor({ state: "visible", timeout: 15000 });

  const readLayout = async () => page.evaluate(() => {
    const overflowingNodes = [...document.querySelectorAll("body *")]
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          className: typeof node.className === "string" ? node.className : node.getAttribute("class"),
          text: (node.textContent ?? "").trim().slice(0, 60),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((node) => node.width > 0 && (node.left < -1 || node.right > window.innerWidth + 1))
      .sort((a, b) => b.right - a.right)
      .slice(0, 12);
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      visibleProducts: new Set(
        [...document.querySelectorAll('a[href^="/inventaris/barang/"]')]
          .map((node) => node.getAttribute("href")),
      ).size,
      overflowingNodes,
    };
  });

  const firstPage = await readLayout();
  if (firstPage.documentWidth > firstPage.viewportWidth + 1 || firstPage.visibleProducts !== 12) {
    throw new Error("Product list first page is not compact/paginated correctly: " + JSON.stringify(firstPage));
  }

  await page.getByRole("button", { name: "Berikutnya" }).click();
  await page.getByText("Menampilkan 13–13 dari 13 barang", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  const secondPage = await readLayout();
  if (secondPage.documentWidth > secondPage.viewportWidth + 1 || secondPage.visibleProducts !== 1) {
    throw new Error("Product list second page is not compact/paginated correctly: " + JSON.stringify(secondPage));
  }

  await page.getByRole("button", { name: "Filter inventaris" }).click();
  const variantFilter = page.getByRole("combobox", { name: "Filter varian produk" });
  await variantFilter.click();
  await page.getByRole("option", { name: "Carrier 2 · 45 L", exact: true }).click();
  await page.getByText("Menampilkan 1–1 dari 1 barang", { exact: true }).waitFor({ state: "visible", timeout: 15000 });

  const filtered = await readLayout();
  if (filtered.documentWidth > filtered.viewportWidth + 1 || filtered.visibleProducts !== 1) {
    throw new Error("Product variant filter returned an unexpected layout/result: " + JSON.stringify(filtered));
  }
  if (!await page.locator('a[href="/inventaris/barang/' + productRows[1].barang_id + '"]').count()) {
    throw new Error("Selected variant should resolve to its parent product.");
  }

  const viewport = page.viewportSize();
  await capture("inventory-product-list-pagination-filter");
  return {
    state: "VERIFIED",
    viewport,
    firstPage,
    secondPage,
    filtered,
    fixture: "network-intercepted 13 synthetic products and one variant; no database mutation",
  };
}
