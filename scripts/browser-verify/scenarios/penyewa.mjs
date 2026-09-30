export default async function penyewaScenario({ page, capture }) {
  const isLogin = page.url().includes("/login");
  if (isLogin) {
    await capture("auth-required");
    return {
      state: "BLOCKED_AUTH",
      reason: "Route Penyewa dilindungi Authenticated dan browser tidak memiliki sesi admin.",
    };
  }

  const body = page.locator("body");
  await body.waitFor({ state: "visible", timeout: 10000 });

  const search = page.getByLabel("Cari berdasarkan nama atau nomor telepon");
  await search.fill("__visual_probe__");
  await page.getByRole("button", { name: "Cari penyewa" }).click();
  await page.getByText("Penyewa tidak ditemukan").waitFor({ state: "visible", timeout: 10000 });
  await capture("search-no-result");

  await page.getByRole("button", { name: "Hapus pencarian" }).click();

  const detailLink = page.viewportSize()?.width && page.viewportSize().width <= 768
    ? page.locator('a:visible[aria-label^="Lihat detail penyewa"]').first()
    : page.locator("a:visible").filter({ hasText: "Lihat detail" }).first();
  const empty = page.getByText("Belum ada penyewa").first();
  await Promise.race([
    detailLink.waitFor({ state: "visible", timeout: 7000 }),
    empty.waitFor({ state: "visible", timeout: 7000 }),
  ]).catch(() => {});
  if (await detailLink.count()) {
    await detailLink.click();
    await page.waitForURL(/\/penyewa\/[^/]+$/, { timeout: 10000 });
    await page.waitForTimeout(700);
    await capture("detail-summary");

    for (const tab of ["Ringkasan", "Identitas", "Kontak", "Operasional"]) {
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(250);
      await capture(`detail-tab-${tab}`);
    }

    await page.goto(`${new URL(page.url()).origin}/penyewa/create`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.getByRole("heading", { level: 1, name: "Daftarkan Penyewa" }).waitFor({
      state: "visible",
      timeout: 10000,
    });

    await page.getByLabel("Nama lengkap").fill("Ahmad Fauzi");
    await page.getByLabel("Nomor telepon").fill("081234567890");
    await page.getByText("Penyewa serupa ditemukan").waitFor({ state: "visible", timeout: 10000 });
    await page.getByText("Tinjau sebelum mendaftarkan").waitFor({ state: "visible", timeout: 10000 });
    await capture("create-duplicate-review");

    return {
      state: "VERIFIED",
      detailVisited: true,
      createVisited: true,
      interaction: [
        "search-no-result",
        "clear-search",
        "open-detail",
        "open-summary-tab",
        "open-identity-tab",
        "open-contact-tab",
        "open-operational-tab",
        "open-create",
        "duplicate-candidate",
        "create-review",
      ],
    };
  }

  if (await empty.count()) {
    await capture("empty-state");
    return {
      state: "VERIFIED",
      detailVisited: false,
      note: "Usaha aktif tidak memiliki penyewa sehingga detail tidak dapat diuji tanpa fixture.",
    };
  }

  await capture("list-no-result-after-clear");
  throw new Error("Setelah menghapus pencarian, runner tidak menemukan detail penyewa maupun empty-state.");
}
