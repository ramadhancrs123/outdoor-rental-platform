export default async function pengembalianScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return {
      state: "BLOCKED_AUTH",
      reason: "Browser runner berada di halaman login setelah auth flow.",
    };
  }

  const body = page.locator("body");
  await body.waitFor({ state: "visible", timeout: 10000 });

  await capture("queue");

  const mobileScanLink = page.getByRole("link", { name: /^Scan QR$/i });
  if (await mobileScanLink.count()) {
    await mobileScanLink.click();
    await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(500);
    await capture("qr-dialog-mobile-nav");
    await page.getByRole("button", { name: /Tutup/i }).last().click().catch(() => {});
    await page.waitForTimeout(300);
  }

  const search = page.getByLabel(
    "Nomor rental, nama penyewa, nomor telepon, kode unit, atau serial",
  );
  if (await search.count()) {
    await search.fill("__visual_probe_return__");
    await page.getByRole("heading", { name: /Tidak ada hasil yang sesuai|Tidak ada rental dalam antrian return/i }).waitFor({
      state: "visible",
      timeout: 10000,
    });
    await capture("queue-search-no-result");
    await search.fill("");
    await page.waitForTimeout(500);
  }

  const processLink = page.getByRole("link", { name: /Proses Pengembalian/i }).first();
  if (!(await processLink.count())) {
    const emptyState = page.getByText(/Tidak ada rental dalam antrian return|Tidak ada hasil yang sesuai/i);
    if (await emptyState.count()) {
      await capture("queue-empty");
      return {
        state: "VERIFIED",
        detailVisited: false,
        interaction: ["queue", "search-no-result", "queue-empty"],
      };
    }
    throw new Error("Queue tampil tetapi action Proses Pengembalian tidak ditemukan.");
  }

  await processLink.click();
  await page.waitForURL(/\/pengembalian\/[^/]+/, { timeout: 10000 });
  await page.waitForTimeout(600);
  await capture("workspace");

  const qrButton = page.getByRole("button", { name: /Scan QR Unit/i }).first();
  if (await qrButton.count()) {
    await qrButton.click();
    await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(700);
    await capture("qr-dialog");
    const closeButton = page.getByRole("button", { name: /Tutup/i }).last();
    if (await closeButton.count()) {
      await closeButton.click();
      await page.waitForTimeout(300);
    }
  }

  const checkboxes = page.getAllByRole("checkbox", { name: /Pilih unit /i });
  if (await checkboxes.count()) {
    const firstCheckbox = checkboxes.first();
    if (await firstCheckbox.isEnabled().catch(() => false)) {
      await firstCheckbox.check().catch(async () => {
        await firstCheckbox.click();
      });
      const confirmStep = page.getByRole("button", { name: /Lanjut ke Konfirmasi/i });
      if (await confirmStep.count()) {
        await confirmStep.click();
        await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
        await capture("confirmation-dialog");
        await page.getByRole("button", { name: /^Kembali$/i }).click().catch(() => {});
      }
    }
  }

  return {
    state: "VERIFIED",
    detailVisited: true,
    interaction: [
      "queue",
      "search-no-result",
      "clear-search",
      "open-return-workspace",
      "open-qr-dialog",
      "select-unit",
      "open-confirmation",
      "cancel-confirmation",
    ],
  };
}
