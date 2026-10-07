export default async function rentalWorkspaceScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return {
      state: "BLOCKED_AUTH",
      reason: "Route Penyewaan dilindungi Authenticated dan browser tidak memiliki sesi admin.",
    };
  }

  await page.getByRole("link", { name: "Penyewaan Langsung" }).waitFor({
    state: "visible",
    timeout: 10000,
  });
  await capture("rental-list-entry");

  await page.getByRole("link", { name: "Penyewaan Langsung" }).click();
  await page.waitForURL((url) => url.pathname.endsWith("/penyewaan/walk-in"), {
    timeout: 10000,
  });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(500);

  await page.getByRole("heading", { name: "Rental Baru" }).waitFor({
    state: "visible",
    timeout: 10000,
  });

  for (const name of [
    "Penyewa",
    "Periode Penyewaan",
    "Barang dan Paket yang Disewa",
    "Tinjauan Transaksi",
  ]) {
    await page.getByText(name, { exact: true }).first().waitFor({
      state: "visible",
      timeout: 5000,
    });
  }

  if (await page.locator('[aria-current="step"]').count()) {
    throw new Error("Stepper wizard lama masih tampil pada workspace Rental.");
  }

  for (const label of [
    /Lanjut ke periode/i,
    /Lanjut ke barang/i,
    /Review Transaksi/i,
    /Buat Draf Penyewaan/i,
  ]) {
    if (await page.getByRole("button", { name: label }).count()) {
      throw new Error(`Kontrol wizard lama masih tampil: ${label}`);
    }
  }

  await page.getByRole("button", { name: "Barang", exact: true }).waitFor({
    state: "visible",
    timeout: 5000,
  });
  await page.getByRole("button", { name: "Paket", exact: true }).waitFor({
    state: "visible",
    timeout: 5000,
  });
  await page.getByRole("button", { name: "Buat Rental", exact: true }).waitFor({
    state: "visible",
    timeout: 5000,
  });

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (horizontalOverflow) {
    throw new Error("Workspace Rental memiliki horizontal overflow.");
  }

  await capture("rental-workspace-single-page");

  return {
    state: "VERIFIED",
    interaction: [
      "open-rental-list",
      "click-penyewaan-langsung",
      "verify-single-page-workspace",
      "verify-no-legacy-stepper",
      "verify-no-legacy-navigation",
      "verify-item-package-controls",
      "verify-rental-submit",
    ],
  };
}
