export default async function scenario({ page, capture }) {
  if (page.url().includes("/login")) return { state: "BLOCKED_AUTH" };

  const receiptButton = page.getByRole("button", { name: "Struk", exact: true });
  await receiptButton.waitFor({ state: "visible", timeout: 10000 });
  await receiptButton.click();

  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await dialog.getByText("Struk Transaksi · Thermal 58 mm", { exact: true }).waitFor();

  const preview = dialog.locator('iframe[title="Pratinjau struk Akasha Outdoor 58 mm"]');
  await preview.waitFor({ state: "visible", timeout: 5000 });

  const receiptDocument = await preview.evaluate((frame) => {
    const document = frame.contentDocument;
    return {
      title: document?.title ?? "",
      text: document?.body?.innerText ?? "",
      pageRule: document?.querySelector("style")?.textContent?.includes("@page { size: 58mm auto; margin: 0; }") ?? false,
      qr: Boolean(document?.querySelector(".qr-wrap img[src^='data:image/png;base64,']")),
      footerAfterQr: Boolean(
        document?.querySelector(".qr-wrap") &&
        document?.querySelector(".footer-message") &&
        document.querySelector(".qr-wrap").compareDocumentPosition(document.querySelector(".footer-message")) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    };
  });

  const requiredTexts = [
    /AKASHA OUTDOOR/i,
    /BUKTI TRANSAKSI/i,
    /DETAIL TRANSAKSI & PENYEWA/i,
    /JADWAL PENYEWAAN/i,
    /RINCIAN BARANG/i,
    /RINGKASAN TRANSAKSI/i,
    /Total Sewa \+ Beli/i,
    /TOTAL TRANSAKSI/i,
    /PEMBAYARAN/i,
    /CATATAN/i,
    /Waktu toleransi pengembalian/i,
    /Semoga perjalanan Anda menyenangkan\./i,
    /Dicetak dengan Akasha Outdoor Management System/i,
    /QR PENYEWAAN/i,
  ];
  for (const pattern of requiredTexts) {
    if (!pattern.test(receiptDocument.text)) {
      throw new Error("Elemen receipt tidak ditemukan: " + String(pattern));
    }
  }

  if (!receiptDocument.pageRule || !receiptDocument.qr || !receiptDocument.logo || !receiptDocument.footerAfterQr || !receiptDocument.toleranceTenBold || !receiptDocument.totalRowsOrdered) {
    throw new Error("Preview struk tidak menggunakan kontrak thermal 58 mm / logo / QR / footer yang benar.");
  }
  if (/NO\.? ?CHECKOUT|NO\.? ?PENJUALAN|TANGGAL TRANSAKSI|SERAH-TERIMA|PENGEMBALIAN AKTUAL|TOTAL RENTAL|TOTAL JUAL|PROMO BARANG \/ PAKET|SELAMAT BERAKTIVITAS|CATATAN UNTUK PENYEWA/i.test(receiptDocument.text)) {
    throw new Error("Struk masih memuat metadata transaksi atau serah-terima yang seharusnya dihilangkan.");
  }
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{4}-\d{2}-\d{2}\.pdf$/.test(receiptDocument.title)) {
    throw new Error("Nama file receipt tidak mengikuti format NAMA-PENYEWA-YYYY-MM-DD.pdf: " + receiptDocument.title);
  }

  for (const label of ["Cetak 58 mm", "Simpan PDF", "Bagikan PNG ke WhatsApp"]) {
    const button = dialog.getByRole("button", { name: label, exact: true });
    await button.waitFor({ state: "visible" });
    if (label !== "Bagikan PNG ke WhatsApp" && !(await button.isEnabled())) {
      throw new Error("Tombol " + label + " belum aktif setelah preview struk berhasil dimuat.");
    }
  }

  await capture("rental-receipt-ui");
  return { state: "VERIFIED", receiptDocument };
}
