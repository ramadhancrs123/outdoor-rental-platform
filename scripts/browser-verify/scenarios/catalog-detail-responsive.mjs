const usahaId = "b0dc9553-1a62-4599-85d7-51a288d33567";
const productId = "visual-product-1";
const tariff = {
  tarif_sewa_id: "visual-tariff-1",
  usaha_id: usahaId,
  barang_id: productId,
  varian_barang_id: null,
  paket_sewa_id: null,
  nama: "Sewa Harian",
  durasi_unit: "hari",
  durasi_nilai: 1,
  nominal: 25000,
  currency_code: "IDR",
  berlaku_mulai: "2026-11-01T00:00:00.000Z",
  berlaku_sampai: null,
  status: "active",
  updated_at: "2026-11-01T00:00:00.000Z",
};

const product = {
  barang_id: productId,
  usaha_id: usahaId,
  kategori_barang_id: "visual-category-1",
  nama: "Carrier Visual",
  slug: "carrier-visual",
  deskripsi: "Carrier untuk perlengkapan pendakian dengan kapasitas penyimpanan luas.",
  ringkasan_publik: "Carrier nyaman untuk perjalanan beberapa hari.",
  status: "active",
  is_public: false,
  updated_at: "2026-11-02T00:00:00.000Z",
  kategori: {
    kategori_barang_id: "visual-category-1",
    nama: "Tas & Carrier",
    status: "active",
  },
};

const media = [{
  barang_media_id: "visual-media-1",
  usaha_id: usahaId,
  barang_id: productId,
  storage_bucket: "rental-public-media",
  storage_path: usahaId + "/visual/" + productId + "/carrier-cover.jpg",
  media_type: "image/jpeg",
  urutan: 1,
  is_cover: true,
  status: "valid",
}];

const variants = [
  {
    varian_barang_id: "visual-variant-45l",
    barang_id: productId,
    usaha_id: usahaId,
    nama: "45 L",
    kode_internal: null,
    deskripsi: "Carrier 45 L untuk pendakian singkat dan perjalanan ringan.",
    atribut_pembeda: { kapasitas: "45 L" },
    status: "active",
    updated_at: "2026-11-02T00:00:00.000Z",
  },
  {
    varian_barang_id: "visual-variant-60l",
    barang_id: productId,
    usaha_id: usahaId,
    nama: "60 L",
    kode_internal: null,
    deskripsi: "Kapasitas ekstra luas untuk membawa perlengkapan pendakian lengkap dan logistik.",
    atribut_pembeda: { kapasitas: "60 L" },
    status: "active",
    updated_at: "2026-11-02T00:00:00.000Z",
  },
];

export default async function catalogDetailResponsive({ page, baseURL, capture }) {
  if (page.url().includes("/login")) {
    await capture("catalog-detail-responsive-auth-required");
    return { state: "BLOCKED_AUTH", reason: "Browser runner berada di halaman login." };
  }

  await page.route("**/storage/v1/object/public/**", async (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: "<svg xmlns='http://www.w3.org/2000/svg' width='900' height='1200' viewBox='0 0 900 1200'><rect width='900' height='1200' fill='#e7ece8'/><path d='M150 900 450 300 750 900Z' fill='#225c49'/><text x='450' y='1050' font-size='70' text-anchor='middle' fill='#17372c'>CARRIER</text></svg>",
  }));

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.continue();

    const url = new URL(request.url());
    const table = url.pathname.split("/").pop();
    let rows = null;

    if (table === "barang" && url.searchParams.get("barang_id") === "eq." + productId) {
      rows = product;
    } else if (table === "varian_barang" && url.searchParams.get("barang_id") === "eq." + productId) {
      rows = variants;
    } else if (table === "tarif_sewa") {
      rows = url.searchParams.get("barang_id") === "eq." + productId ? [tariff] : [];
    } else if (table === "barang_media" && url.searchParams.get("barang_id") === "eq." + productId) {
      rows = media;
    } else if (table === "komponen_paket" && url.searchParams.get("barang_id") === "eq." + productId) {
      rows = [];
    }

    if (rows === null) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows),
    });
  });

  await page.goto(baseURL + "/katalog/show/" + productId, { waitUntil: "domcontentloaded" });
  await page.getByText("Informasi produk", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("img", { name: "Cover Carrier Visual" }).waitFor({ state: "visible", timeout: 10000 });

  const viewport = page.viewportSize();
  const metrics = await page.evaluate(() => {
    const section = document.querySelector('[aria-label="Media dan informasi produk"]');
    const cards = section ? [...section.querySelectorAll('[data-slot="card"]')] : [];
    const readRect = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      section: readRect(section),
      contentContainer: readRect(section?.parentElement),
      gridTemplateColumns: section ? getComputedStyle(section).gridTemplateColumns : null,
      gallery: readRect(cards[0]),
      information: readRect(cards[1]),
      image: readRect(section?.querySelector('img[alt="Cover Carrier Visual"]')),
    };
  });

  if (metrics.documentWidth > metrics.viewportWidth + 1) {
    throw new Error("Horizontal overflow on detail page: " + JSON.stringify(metrics));
  }
  if (!metrics.section || !metrics.contentContainer || metrics.section.width < metrics.contentContainer.width - 4) {
    throw new Error("Detail content does not use the available page width: " + JSON.stringify(metrics));
  }
  if (metrics.image && metrics.gallery && metrics.image.width > metrics.gallery.width + 1) {
    throw new Error("Product image exceeds the gallery width: " + JSON.stringify(metrics));
  }

  const columnCount = metrics.gridTemplateColumns?.split(" ").length ?? 0;
  if (columnCount !== 2 || !metrics.gallery || !metrics.information || metrics.information.x <= metrics.gallery.x) {
    throw new Error("Product media and information must render as a two-part responsive summary: " + JSON.stringify(metrics));
  }

  if (viewport.width < 640) {
    if (Math.abs(metrics.gallery.y - metrics.information.y) > 1) {
      throw new Error("Mobile gallery and information must align in one compact row: " + JSON.stringify(metrics));
    }
    if (metrics.information.width <= metrics.gallery.width) {
      throw new Error("Mobile information panel must have more reading space than the cover preview: " + JSON.stringify(metrics));
    }
    if (metrics.gallery.right >= metrics.information.x) {
      throw new Error("Mobile product summary cards overlap: " + JSON.stringify(metrics));
    }
  } else if (metrics.information.x <= metrics.gallery.x || metrics.information.width < metrics.gallery.width * 0.7) {
    throw new Error("Tablet/desktop detail content should retain balanced side-by-side columns: " + JSON.stringify(metrics));
  }

  await capture("catalog-detail-responsive");
  return {
    state: "VERIFIED",
    viewport,
    metrics,
    fixture: "network-intercepted synthetic product; no database mutation",
  };
}
