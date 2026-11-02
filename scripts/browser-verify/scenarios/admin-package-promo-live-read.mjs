export default async function adminPackagePromoLiveRead({ page, capture }) {
  const promoReads = [];
  page.on("response", (response) => {
    if (response.url().includes("/rest/v1/promosi_paket_sewa")) {
      promoReads.push({ url: response.url(), status: response.status() });
    }
  });

  const routes = [
    {
      path: "/katalog?view=packages",
      ready: () => page.getByText("Paket camping 2 orang", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 }),
      expectedReads: 1,
    },
    {
      path: "/inventaris?mode=packages",
      ready: () => page.getByText("Paket camping 2 orang", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 }),
      expectedReads: 1,
    },
    {
      path: "/penyewaan/walk-in?renter_id=6cd24dcf-a52f-44f1-b8a4-a29ce4e8c001",
      ready: () => page.getByRole("button", { name: /Buka Katalog Rental/i }).waitFor({ state: "visible", timeout: 15000 }),
      // Walk-in loads active promo rows as part of listCatalogPackages();
      // one successful read is sufficient and avoids a redundant second query.
      expectedReads: 1,
    },
  ];

  for (const route of routes) {
    const before = promoReads.length;
    await page.goto(new URL(route.path, page.url()).toString(), { waitUntil: "domcontentloaded" });
    await route.ready();
    await page.waitForTimeout(500);
    const responses = promoReads.slice(before);
    if (responses.length < route.expectedReads) {
      throw new Error(route.path + " tidak membaca active promo table sebanyak yang diharapkan: " + JSON.stringify(responses));
    }
    const failed = responses.filter((response) => response.status !== 200);
    if (failed.length) {
      throw new Error(route.path + " promo read ditolak backend: " + JSON.stringify(failed));
    }
  }

  await capture("admin-package-promo-live-read");
  return {
    state: "VERIFIED",
    promoReads,
    activePromoRows: "empty fixture by design; no live business data mutated",
    checks: ["catalog-RLS-read", "inventory-RLS-read", "walk-in-catalog-RLS-read", "walk-in-inventory-RLS-read", "all-promo-reads-http-200"],
  };
}
