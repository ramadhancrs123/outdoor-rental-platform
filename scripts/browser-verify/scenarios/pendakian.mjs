export default async function pendakianScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return {
      state: "BLOCKED_AUTH",
      reason: "Browser verification tidak memiliki sesi super admin yang aktif.",
    };
  }

  await page.getByRole("heading", { level: 1, name: "Pendakian" }).waitFor({
    state: "visible",
    timeout: 15000,
  });
  await page.waitForTimeout(1800);

  const loadError = page.getByText("Data pendakian belum dapat dibuka", { exact: true });
  if (await loadError.count()) {
    await capture("admin-load-error-before-retry");
    await page.getByRole("button", { name: "Coba lagi" }).click();
    await page.waitForTimeout(4000);
    if (await loadError.count()) {
      await capture("admin-load-error-after-retry");
      return { state: "FAILED", reason: "API admin pendakian masih gagal setelah dicoba ulang." };
    }
  }

  await page.getByRole("button", { name: "Data & peta", exact: true }).waitFor({
    state: "visible",
    timeout: 10000,
  });
  await page.waitForTimeout(1800);

  const required = [
    page.getByRole("heading", { name: "Informasi gunung" }),
    page.getByRole("heading", { name: "Peta lokasi dan jalur" }),
    page.getByRole("heading", { name: "Impor rute dari GPX" }),
    page.getByRole("heading", { name: "Tambah titik penting" }),
    page.getByRole("heading", { name: "Cuaca wilayah otomatis" }),
  ];
  for (const locator of required) {
    await locator.waitFor({ state: "visible", timeout: 10000 });
  }
  await capture("combined-workspace");

  const preview = page.getByTestId("hiking-map-preview");
  if (await preview.count()) {
    await capture("map-preview");
  } else {
    const mapCanvas = page.locator(".maplibregl-canvas");
    await mapCanvas.first().waitFor({ state: "visible", timeout: 15000 });
    await capture("maplibre-rendered");

    const logoLink = page.locator(".maplibre-maptoolkit-logo-control a");
    await logoLink.waitFor({ state: "visible", timeout: 10000 });
    const logoHref = await logoLink.getAttribute("href");
    if (!logoHref || !logoHref.startsWith("https://maptoolkit.org/")) {
      throw new Error("Logo Maptoolkit tidak terpasang atau tautannya tidak sesuai.");
    }
    const logoBox = await logoLink.boundingBox();
    if (!logoBox || logoBox.height < 24) {
      throw new Error("Logo Maptoolkit harus tetap tampil dengan tinggi minimal 24 px.");
    }

    const attribution = page.locator(".maplibregl-ctrl-attrib");
    await attribution.waitFor({ state: "visible", timeout: 10000 });
    const attributionText = (await attribution.innerText()).replace(/\s+/g, " ");
    if (!/Maptoolkit/i.test(attributionText) || !/OpenStreetMap/i.test(attributionText)) {
      throw new Error("Atribusi Maptoolkit/OpenStreetMap belum terlihat lengkap.");
    }

    const mapResources = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name),
    );
    if (!mapResources.some((url) => url.startsWith("https://styles.maptoolkit.org/hiking.json"))) {
      throw new Error("Gaya peta Maptoolkit Hiking tidak dimuat.");
    }
    if (mapResources.some((url) => /openfreemap/i.test(url))) {
      throw new Error("Permintaan ke OpenFreeMap masih ditemukan.");
    }

    // Verify map-first admin automation without saving anything to Supabase.
    await page.getByRole("button", { name: "Pilih titik dari peta", exact: true }).click();
    await mapCanvas.first().click();
    await page.getByText("Titik gunung telah dipilih", { exact: true }).waitFor({
      state: "visible",
      timeout: 10000,
    });
    await capture("map-pick-auto-coordinates");
  }

  const safetyButton = page.getByRole("button", { name: "Keselamatan", exact: true });
  await safetyButton.click();
  await page.getByRole("heading", { name: "Buat peringatan keselamatan" }).waitFor({
    state: "visible",
    timeout: 10000,
  });
  await page.getByText("Peringatan ditujukan ke", { exact: false }).waitFor({ state: "visible", timeout: 10000 });
  if (await page.getByText("Untuk gunung", { exact: true }).count()) throw new Error("Form sasaran gunung duplikat masih tampil.");
  if (await page.getByText("Untuk jalur", { exact: true }).count()) throw new Error("Form sasaran jalur duplikat masih tampil.");
  await capture("single-safety-target");

  const visibleLoadError = await loadError.count();
  if (visibleLoadError) throw new Error("API error state muncul kembali saat berpindah bagian.");

  return {
    state: "VERIFIED",
    workspaceLoaded: true,
    singlePageCoreWorkflow: true,
    errorRetryPassed: true,
    safetyTargetSelector: true,
    tabsVisited: ["Data & peta", "Keselamatan"],
    note: "Scenario tidak membuat atau mengubah data gunung/jalur.",
  };
}
