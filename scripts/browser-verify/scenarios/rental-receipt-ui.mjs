export default async function scenario({ page, capture }) {
  if (page.url().includes("/login")) return { state: "BLOCKED_AUTH" };

  const struk = page.getByRole("button", { name: "Struk", exact: true });
  await struk.waitFor({ state: "visible", timeout: 10000 });
  await struk.click();

  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });

  const requiredTexts = [
    /Bukti Penyewaan · Thermal 58 mm/i,
    /PERIODE RENTAL/i,
    /PENYEWA/i,
    /ITEM RENTAL/i,
    /TOTAL RENTAL/i,
    /QR PENYEWAAN/i,
    /SEMOGA PERJALANAN ANDA MENYENANGKAN/i,
  ];
  for (const pattern of requiredTexts) {
    if (!(await dialog.getByText(pattern).count())) {
      throw new Error("Elemen receipt tidak ditemukan: " + String(pattern));
    }
  }

  const pdfDownloadPromise = page.waitForEvent("download", { timeout: 10000 });
  await dialog.getByRole("button", { name: "PDF 58 mm", exact: true }).click();
  const pdfDownload = await pdfDownloadPromise;
  if (!pdfDownload.suggestedFilename().endsWith("-58mm.pdf")) {
    throw new Error("PDF thermal tidak menggunakan nama file 58mm.");
  }
  await pdfDownload.saveAs(process.cwd() + "/.visual-verify/" + pdfDownload.suggestedFilename());

  const pagesBeforePrint = page.context().pages().length;
  await dialog.getByRole("button", { name: "Cetak 58 mm", exact: true }).click();
  await page.waitForTimeout(300);

  const printSurface = await page.evaluate(() => {
    const frame = Array.from(document.querySelectorAll("iframe")).find((item) => {
      return item.getAttribute("aria-hidden") === "true";
    });
    const html = frame?.contentDocument?.documentElement?.outerHTML ?? "";
    return {
      found: Boolean(frame),
      thermal: html.includes("@page { size: 58mm auto; margin: 0; }"),
      footer: html.includes("SEMOGA PERJALANAN ANDA MENYENANGKAN"),
      qr: html.includes("data:image/png;base64,"),
      rental: html.includes("Bukti Penyewaan"),
      payment: html.includes("PEMBAYARAN"),
    };
  });

  if (!printSurface.found || !printSurface.thermal || !printSurface.footer || !printSurface.qr || !printSurface.rental || !printSurface.payment) {
    throw new Error("Print surface thermal 58mm tidak memenuhi kontrak receipt.");
  }
  if (page.context().pages().length !== pagesBeforePrint) {
    throw new Error("Cetak receipt membuka tab baru.");
  }

  await capture("rental-receipt-ui");
  return { state: "VERIFIED", printSurface };
}
