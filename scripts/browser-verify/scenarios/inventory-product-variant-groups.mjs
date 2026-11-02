const productId = "10000000-0000-4000-8000-000000000001";
const variant45Id = "10000000-0000-4000-8000-000000000011";
const variant60Id = "10000000-0000-4000-8000-000000000012";
const product = {
  barang_id: productId,
  kategori_barang_id: "10000000-0000-4000-8000-000000000041",
  nama: "Carrier",
  slug: "carrier",
  deskripsi: "Carrier untuk kebutuhan pendakian.",
  ringkasan_publik: "Tas carrier untuk perjalanan outdoor.",
  status: "active",
  is_public: true,
  updated_at: "2026-11-02T00:00:00.000Z",
  kategori: {
    kategori_barang_id: "10000000-0000-4000-8000-000000000041",
    nama: "Tas & Carrier",
    status: "active",
  },
};

const variants = [
  {
    varian_barang_id: variant45Id,
    barang_id: productId,
    nama: "45 L",
    kode_internal: "CARRIER-45L",
    deskripsi: "Carrier 45 L.",
    atribut_pembeda: { kapasitas: "45 L" },
    status: "active",
  },
  {
    varian_barang_id: variant60Id,
    barang_id: productId,
    nama: "60 L",
    kode_internal: "CARRIER-60L",
    deskripsi: "Carrier 60 L.",
    atribut_pembeda: { kapasitas: "60 L" },
    status: "active",
  },
];

const uuidFor = (index) => "10000000-0000-4000-8000-" + String(index).padStart(12, "0");
const makeUnit = (index, variant) => ({
  unit_barang_id: uuidFor(100 + index),
  barang_id: productId,
  varian_barang_id: variant.varian_barang_id,
  kode_unit: "TAS-CARRIER-CARRIER-" + String(index + 1).padStart(3, "0"),
  serial_number: null,
  lokasi_id: null,
  tanggal_diperoleh: "2026-10-01",
  sumber_pembelian_detail_id: null,
  status: index % 4 === 0 ? "rented" : "ready",
  kondisi_ringkas: "Baik",
  catatan_internal: null,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  barang: { barang_id: productId, nama: "Carrier", slug: "carrier", status: "active" },
  varian: {
    varian_barang_id: variant.varian_barang_id,
    nama: variant.nama,
    kode_internal: variant.kode_internal,
    status: "active",
  },
  lokasi: {
    lokasi_id: uuidFor(200),
    nama: "Gudang Utama",
    tipe: "warehouse",
    status: "active",
  },
});

const units = [
  ...Array.from({ length: 7 }, (_, index) => makeUnit(index, variants[0])),
  ...Array.from({ length: 6 }, (_, index) => makeUnit(index + 7, variants[1])),
];

function readRange(url) {
  const start = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 6);
  return { start, end: start + limit - 1 };
}

export default async function inventoryProductVariantGroups({ page, baseURL, capture }) {
  if (page.url().includes("/login")) {
    await capture("inventory-product-auth-required");
    return { state: "BLOCKED_AUTH", reason: "Browser runner berada di halaman login." };
  }

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET" && request.method() !== "POST") return route.continue();

    const url = new URL(request.url());
    const table = url.pathname.split("/").pop();
    const usahaId = url.searchParams.get("usaha_id")?.replace(/^eq\./, "") ?? "10000000-0000-4000-8000-000000000099";

    if (table === "barang" && url.searchParams.get("barang_id")?.includes(productId)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ ...product, usaha_id: usahaId }]),
      });
    }

    if (table === "varian_barang" && url.searchParams.get("barang_id")?.includes(productId)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(variants.map((variant) => ({ ...variant, usaha_id: usahaId }))),
      });
    }

    if (table === "barang_media" && url.searchParams.get("barang_id")?.includes(productId)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }

    if (table === "inventory_product_overview") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          barang_id: productId,
          nama: "Carrier",
          slug: "carrier",
          status: "active",
          kategori_nama: "Tas & Carrier",
          total_unit: units.length,
          ready_unit: 9,
          rented_unit: 4,
          attention_unit: 0,
          inspection_pending_unit: 0,
          maintenance_unit: 0,
          damaged_unit: 0,
          lost_unit: 0,
          inactive_unit: 0,
          variant_count: 2,
          latest_unit_updated_at: "2026-11-01T00:00:00.000Z",
          cover_bucket: null,
          cover_path: null,
        }]),
      });
    }

    if (table === "riwayat_unit") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }

    if (table === "unit_barang" && url.searchParams.get("barang_id")?.includes(productId)) {
      const variantFilter = url.searchParams.get("varian_barang_id");
      const filteredUnits = variantFilter === "eq." + variant60Id
        ? units.filter((unit) => unit.varian_barang_id === variant60Id)
        : variantFilter === "is.null"
          ? units.filter((unit) => unit.varian_barang_id === null)
          : units;
      const { start, end } = readRange(url);
      const pageRows = filteredUnits.slice(start, end + 1);
      const rangeEnd = pageRows.length ? start + pageRows.length - 1 : start - 1;

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "content-range": rangeEnd >= start
            ? start + "-" + rangeEnd + "/" + filteredUnits.length
            : "*/" + filteredUnits.length,
          "accept-ranges": "items",
          "access-control-expose-headers": "Content-Range, Range, Accept-Ranges",
        },
        body: JSON.stringify(pageRows.map((unit) => ({ ...unit, usaha_id: usahaId }))),
      });
    }

    return route.continue();
  });

  await page.goto(baseURL + "/inventaris/barang/" + productId, { waitUntil: "domcontentloaded" });
  await page.getByText("Detail Inventaris", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: "Unit" }).click();
  await page.getByText("Menampilkan 1–10 dari 13 unit", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("region", { name: "Varian 45 L" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("region", { name: "Varian 60 L" }).waitFor({ state: "visible", timeout: 10000 });

  const firstPage = await page.evaluate(() => {
    const group45 = document.querySelector('[aria-label="Varian 45 L"]');
    const group60 = document.querySelector('[aria-label="Varian 60 L"]');
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      group45Count: group45?.querySelectorAll("a").length ?? 0,
      group60Count: group60?.querySelectorAll("a").length ?? 0,
      descriptionCard: [...document.querySelectorAll("h2,h3")].some((node) => node.textContent?.trim() === "Deskripsi"),
    };
  });

  if (firstPage.documentWidth > firstPage.viewportWidth + 1) {
    throw new Error("Horizontal overflow in inventory detail: " + JSON.stringify(firstPage));
  }
  if (firstPage.group45Count + firstPage.group60Count !== 10) {
    throw new Error("Page 1 must render exactly 10 units: " + JSON.stringify(firstPage));
  }
  if (firstPage.descriptionCard) {
    throw new Error("The long product description card should stay removed from inventory detail.");
  }

  await page.getByRole("button", { name: "Berikutnya" }).click();
  await page.getByText("Menampilkan 11–13 dari 13 unit", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  const secondPageCount = await page.locator('[aria-label^="Varian "] a').count();
  if (secondPageCount !== 3) throw new Error("Page 2 must render exactly 3 units; got " + secondPageCount);

  const variantFilter = page.getByRole("combobox", { name: "Filter varian unit" });
  await variantFilter.click();
  await page.getByRole("option", { name: "60 L", exact: true }).click();
  await page.getByText("Menampilkan 1–6 dari 6 unit", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  if (await page.getByRole("region", { name: "Varian 45 L" }).count()) {
    throw new Error("Variant filter 60 L must hide the 45 L group.");
  }
  await page.getByRole("region", { name: "Varian 60 L" }).waitFor({ state: "visible" });

  const viewport = page.viewportSize();
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    remainingUnitRows: document.querySelectorAll('[aria-label="Varian 60 L"] a').length,
  }));
  if (metrics.documentWidth > metrics.viewportWidth + 1) {
    throw new Error("Horizontal overflow after applying variant filter: " + JSON.stringify(metrics));
  }
  if (metrics.remainingUnitRows !== 6) {
    throw new Error("Variant filter should show only six 60 L units: " + JSON.stringify(metrics));
  }

  await capture("inventory-product-variant-groups-pagination");
  return {
    state: "VERIFIED",
    viewport,
    firstPage,
    secondPageCount,
    filteredVariant: metrics,
    fixture: "network-intercepted synthetic carrier; 13 units over 45 L and 60 L; no database mutation",
  };
}
