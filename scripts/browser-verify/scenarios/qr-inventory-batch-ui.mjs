import path from "node:path";

export default async function scenario({ page, capture }) {
  if (page.url().includes("/login")) return { state: "BLOCKED_AUTH" };

  const scan = page.getByRole("button", { name: "Pindai QR", exact: true });
  await scan.waitFor({ state: "visible", timeout: 10000 });
  const batch = page.getByRole("button", { name: "Cetak QR Unit", exact: true });
  await batch.waitFor({ state: "visible", timeout: 10000 });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error("Inventaris mengalami horizontal overflow setelah penambahan aksi QR.");

  await batch.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  if (!(await dialog.getByText("Cetak QR Unit", { exact: true }).count())) {
    throw new Error("Dialog batch QR unit tidak terbuka.");
  }
  if (!(await dialog.getByRole("button", { name: "Cetak A4", exact: true }).count())) {
    throw new Error("Aksi Cetak A4 tidak tersedia.");
  }
  if (!(await dialog.getByRole("button", { name: "PDF A4", exact: true }).count())) {
    throw new Error("Aksi PDF A4 tidak tersedia.");
  }

  const pdfDownloadPromise = page.waitForEvent("download", { timeout: 10000 });
  await dialog.getByRole("button", { name: "PDF A4", exact: true }).click();
  const pdfDownload = await pdfDownloadPromise;
  if (!pdfDownload.suggestedFilename().endsWith(".pdf")) {
    throw new Error("Batch PDF tidak menghasilkan file PDF.");
  }
  await pdfDownload.saveAs(path.join(process.cwd(), ".visual-verify", "qr-unit-batch-a4.pdf"));

  const pagesBeforePrint = page.context().pages().length;
  await dialog.getByRole("button", { name: "Cetak A4", exact: true }).click();
  await page.waitForTimeout(250);

  const printSurface = await page.evaluate(() => {
    const frame = Array.from(document.querySelectorAll("iframe")).find((item) => {
      return item.getAttribute("aria-hidden") === "true";
    });
    if (!frame?.contentDocument) return { found: false, a4: false, qr: false, code: false };
    const html = frame.contentDocument.documentElement.outerHTML;
    return {
      found: true,
      a4: html.includes("@page { size: A4 portrait; margin: 10mm; }"),
      qr: html.includes("data:image/png;base64,"),
      code: html.includes("Scan untuk membuka detail unit"),
    };
  });

  if (!printSurface.found || !printSurface.a4 || !printSurface.qr || !printSurface.code) {
    throw new Error("Print surface A4 tidak memuat QR dan label unit sesuai kontrak.");
  }

  await page.waitForTimeout(500);
  if (page.context().pages().length !== pagesBeforePrint) {
    throw new Error("Cetak batch membuka tab baru; print seharusnya memakai iframe di halaman yang sama.");
  }

  await capture("qr-inventory-batch-ui");
  return { state: "VERIFIED" };
}
