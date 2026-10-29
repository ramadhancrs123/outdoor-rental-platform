import { mkdir } from "node:fs/promises";
import path from "node:path";

export default async function laporanScenario({ page, capture }) {
  const artifactDir = path.resolve(process.env.VISUAL_ARTIFACT_DIR || ".visual-verify-laporan");
  await mkdir(artifactDir, { recursive: true });
  await page.getByTestId("reports-page").waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("heading", { name: "Laporan" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "Ekspor Excel (.xlsx)" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "Ekspor PDF" }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Tanggal mulai").waitFor({ state: "visible", timeout: 5000 });
  await page.getByLabel("Tanggal selesai").waitFor({ state: "visible", timeout: 5000 });
  await page.getByText("Transaksi Keuangan", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await capture("finance-report-ready");

  if (await page.getByText(/Laporan gagal dimuat/i).count()) {
    return { state: "FAILED", reason: "Finance report failed to load." };
  }

  const [financeExcelDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByRole("button", { name: "Ekspor Excel (.xlsx)" }).click(),
  ]).catch(() => [null]);
  if (!financeExcelDownload || !financeExcelDownload.suggestedFilename().endsWith(".xlsx")) {
    await capture("finance-excel-download-failed");
    return { state: "FAILED", reason: "Finance XLSX download failed." };
  }
  const financeExcelPath = path.join(artifactDir, financeExcelDownload.suggestedFilename());
  await financeExcelDownload.saveAs(financeExcelPath);

  const [financePdfDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByRole("button", { name: "Ekspor PDF" }).click(),
  ]).catch(() => [null]);
  if (!financePdfDownload || !financePdfDownload.suggestedFilename().endsWith(".pdf")) {
    await capture("finance-pdf-download-failed");
    return { state: "FAILED", reason: "Finance PDF download failed." };
  }
  const financePdfPath = path.join(artifactDir, financePdfDownload.suggestedFilename());
  await financePdfDownload.saveAs(financePdfPath);

  await page.getByRole("button", { name: "Penyewaan", exact: true }).click();
  await page.waitForURL(/modul=penyewaan/, { timeout: 5000 });
  await page.getByText("Daftar Penyewaan", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  if (await page.getByText(/Laporan gagal dimuat/i).count()) {
    await capture("rental-report-load-error");
    return { state: "FAILED", reason: "Rental report failed to load." };
  }
  await capture("rental-report-ready");

  const [excelDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.getByRole("button", { name: "Ekspor Excel (.xlsx)" }).click(),
  ]).catch(() => [null]);
  if (!excelDownload) {
    await capture("rental-excel-download-failed");
    return { state: "FAILED", reason: "Rental XLSX download was not triggered." };
  }
  if (!excelDownload.suggestedFilename().endsWith(".xlsx")) {
    return { state: "FAILED", reason: "Rental export returned a non-XLSX file name." };
  }
  const excelPath = path.join(artifactDir, excelDownload.suggestedFilename());
  await excelDownload.saveAs(excelPath);

  const [pdfDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.getByRole("button", { name: "Ekspor PDF" }).click(),
  ]).catch(() => [null]);
  if (!pdfDownload) {
    await capture("rental-pdf-download-failed");
    return { state: "FAILED", reason: "Rental PDF download was not triggered." };
  }
  if (!pdfDownload.suggestedFilename().endsWith(".pdf")) {
    return { state: "FAILED", reason: "Rental export returned a non-PDF file name." };
  }
  const pdfPath = path.join(artifactDir, pdfDownload.suggestedFilename());
  await pdfDownload.saveAs(pdfPath);

  await capture("rental-exports-ready");
  await page.getByRole("button", { name: "Keuangan", exact: true }).click();
  await page.waitForURL((url) => !url.searchParams.has("modul"), { timeout: 5000 });
  await page.getByText("Transaksi Keuangan", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await capture("finance-report-restored");

  return {
    state: "VERIFIED",
    financeReportReady: true,
    rentalReportReady: true,
    financeExcelDownload: financeExcelDownload.suggestedFilename(),
    financeExcelPath,
    financePdfDownload: financePdfDownload.suggestedFilename(),
    financePdfPath,
    rentalExcelDownload: excelDownload.suggestedFilename(),
    excelPath,
    rentalPdfDownload: pdfDownload.suggestedFilename(),
    pdfPath,
    moduleSwitchWorks: true,
  };
}
