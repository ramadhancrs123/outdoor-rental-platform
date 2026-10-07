export default async function scenario({ page, capture }) {
  if (page.url().includes("/login")) return { state: "BLOCKED_AUTH" };

  const actionsTab = page.getByRole("navigation", { name: "Bagian detail unit" }).getByRole("button", { name: "Aksi", exact: true });
  await actionsTab.waitFor({ state: "visible", timeout: 10000 });
  await actionsTab.click();
  await page.getByRole("button", { name: /Lihat QR Unit/i }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: /Lihat QR Unit/i }).click();

  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  if (!(await dialog.getByText("QR Unit", { exact: true }).count())) {
    throw new Error("Preview QR Unit tidak muncul.");
  }
  if (!(await dialog.getByRole("button", { name: "PDF", exact: true }).count())) {
    throw new Error("Aksi PDF QR unit tidak tersedia.");
  }
  if (!(await dialog.getByRole("button", { name: "Cetak", exact: true }).count())) {
    throw new Error("Aksi cetak single QR unit tidak tersedia.");
  }

  const pdfDownloadPromise = page.waitForEvent("download", { timeout: 10000 });
  await dialog.getByRole("button", { name: "PDF", exact: true }).click();
  const pdfDownload = await pdfDownloadPromise;
  if (!pdfDownload.suggestedFilename().endsWith(".pdf")) {
    throw new Error("Single QR PDF tidak menghasilkan file PDF.");
  }

  const pagesBeforePrint = page.context().pages().length;
  await dialog.getByRole("button", { name: "Cetak", exact: true }).click();
  await page.waitForTimeout(700);
  if (page.context().pages().length !== pagesBeforePrint) {
    throw new Error("Cetak single QR membuka tab baru.");
  }

  await capture("qr-inventory-detail-ui");
  return { state: "VERIFIED" };
}
