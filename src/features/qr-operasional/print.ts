import type { RentalReceiptData, RentalQrLineData, UnitQrLabelData, UnitQrLabelOptions } from "./types";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatReceiptDateTime(value: string | null | undefined, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value)).replace(".", ":");
}

function formatReceiptMoney(amount: number, currencyCode: string) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(amount);
}

function paymentLabel(status: NonNullable<RentalReceiptData["pembayaran"]>["status"]) {
  if (status === "lunas") return "LUNAS";
  if (status === "sebagian") return "SEBAGIAN";
  return "BELUM DIBAYAR";
}

function formatFileDate(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Stable, filesystem-safe name based on renter identity and rental start date. */
export function buildRentalReceiptFileName(receipt: Pick<RentalReceiptData, "penyewa_nama" | "jadwal_mulai" | "timezone">) {
  const renter = (receipt.penyewa_nama
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "PENYEWA").slice(0, 72).replace(/-+$/g, "");
  return `${renter}-${formatFileDate(receipt.jadwal_mulai, receipt.timezone)}`;
}

function renderReceiptLine(line: RentalQrLineData, currencyCode: string, channel: "SEWA" | "JUAL") {
  const subtotal = Number(line.subtotal || 0);
  const promoDiscount = Math.max(0, Number(line.nominal_diskon_snapshot || 0));
  const promoPercent = Number(line.diskon_persen_snapshot || 0);
  const unitPrice = line.unit_price == null
    ? subtotal / Math.max(1, line.jumlah)
    : Number(line.unit_price);
  const normalAmount = subtotal + promoDiscount;
  const promoRows = promoDiscount > 0
    ? `<div class="item-subrow"><span>Harga normal</span><strong>${escapeHtml(formatReceiptMoney(normalAmount, currencyCode))}</strong></div>
       <div class="item-subrow promo"><span>${escapeHtml(line.promo_label || "Promo katalog")}${promoPercent > 0 ? ` (${promoPercent}%)` : ""}</span><strong>−${escapeHtml(formatReceiptMoney(promoDiscount, currencyCode))}</strong></div>`
    : "";
  const periodMeta = channel === "SEWA" && line.period_count && line.period_count > 0
    ? ` · ${line.period_count} periode${line.period_description ? ` × ${escapeHtml(line.period_description)}` : ""}`
    : "";

  return `<article class="item">
    <div class="item-top">
      <div class="item-heading"><span class="item-kind ${channel.toLowerCase()}">${channel}</span><span class="item-name">${escapeHtml(line.nama)}${line.rincian ? ` <span class="variant">· ${escapeHtml(line.rincian)}</span>` : ""}</span></div>
      <div class="item-total">${escapeHtml(formatReceiptMoney(subtotal, currencyCode))}</div>
    </div>
    ${promoRows}
    <div class="item-meta">${Number(line.jumlah)} × ${escapeHtml(formatReceiptMoney(unitPrice, currencyCode))}${periodMeta}</div>
  </article>`;
}

export function getReceiptToleranceHours(jadwalKembali: string, toleranceDeadline?: string | null) {
  if (!toleranceDeadline) return 0;
  const returnAt = new Date(jadwalKembali).getTime();
  const deadlineAt = new Date(toleranceDeadline).getTime();
  if (!Number.isFinite(returnAt) || !Number.isFinite(deadlineAt)) return 0;
  return Math.max(0, Math.round(((deadlineAt - returnAt) / 3_600_000) * 100) / 100);
}

function renderAmountRow(label: string, amount: number, currencyCode: string, kind: "normal" | "discount" = "normal") {
  if (amount <= 0) return "";
  const value = formatReceiptMoney(amount, currencyCode);
  return `<div class="amount-row ${kind}"><span>${escapeHtml(label)}</span><strong>${kind === "discount" ? "−" : ""}${escapeHtml(value)}</strong></div>`;
}

/** The single compact renderer shared by preview, native thermal print, PDF, and PNG. */
export function buildRentalReceiptHtml(receipt: RentalReceiptData, qrDataUrl: string, logoDataUrl = "/logo.webp") {
  const currency = receipt.currency_code || "IDR";
  const rentalLines = receipt.lines.map((line) => renderReceiptLine(line, line.currency_code || currency, "SEWA")).join("");
  const saleLines = (receipt.sale_lines ?? []).map((line) => renderReceiptLine(line, line.currency_code || currency, "JUAL")).join("");
  const allLines = `${rentalLines}${saleLines}`;
  const discounts = receipt.discounts;
  const discountRows = discounts
    ? [
        renderAmountRow("Promo / Diskon Sewa", Number(discounts.manual_rental || 0), currency, "discount"),
        renderAmountRow("Diskon Loyalitas Rental", Number(discounts.loyalty_rental || 0), currency, "discount"),
        renderAmountRow("Diskon Loyalitas Penjualan", Number(discounts.loyalty_sale || 0), currency, "discount"),
        renderAmountRow(discounts.other_rental_label || "Diskon Rental", Number(discounts.other_rental || 0), currency, "discount"),
      ].join("")
    : "";
  const hasDiscount = Boolean(discounts && (
    Number(discounts.manual_rental || 0) > 0
    || Number(discounts.loyalty_rental || 0) > 0
    || Number(discounts.loyalty_sale || 0) > 0
    || Number(discounts.other_rental || 0) > 0
  ));
  const contact = [receipt.usaha_telepon, receipt.usaha_email].filter(Boolean).join(" · ");
  const address = receipt.usaha_alamat
    ? `<div class="business-address">${escapeHtml(receipt.usaha_alamat)}</div>`
    : "";
  const contactHtml = contact
    ? `<div class="business-contact">${escapeHtml(contact)}</div>`
    : "";
  const payment = receipt.pembayaran
    ? `<section class="section payment-section">
        <div class="section-title">PEMBAYARAN</div>
        <div class="meta-row"><span>Status</span><strong>${paymentLabel(receipt.pembayaran.status)}</strong></div>
        <div class="meta-row"><span>Dibayar</span><strong>${escapeHtml(formatReceiptMoney(receipt.pembayaran.tercatat, currency))}</strong></div>
        <div class="meta-row"><span>Sisa</span><strong>${escapeHtml(formatReceiptMoney(receipt.pembayaran.sisa, currency))}</strong></div>
      </section>`
    : "";
  const note = `<section class="section receipt-note"><div class="section-title">Catatan</div><div class="small-note">Waktu toleransi pengembalian <strong>10</strong> jam</div></section>`;
  const qr = qrDataUrl
    ? `<div class="qr-wrap"><img class="qr" src="${escapeHtml(qrDataUrl)}" alt="QR Penyewaan" /><div class="qr-caption">QR PENYEWAAN</div></div>`
    : "";
  const fileName = buildRentalReceiptFileName(receipt);

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(fileName)}.pdf</title>
<style>
@page { size: 58mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { width: 58mm; color: #111827; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.receipt { width: 52mm; margin: 0 auto; padding: 3mm 0 4mm; }
.center { text-align: center; }
.brand-logo { display: block; width: 10mm; height: 10mm; object-fit: contain; margin: 0 auto 1.2mm; }
.brand { font-size: 10pt; line-height: 1.1; font-weight: 900; letter-spacing: .055em; text-transform: uppercase; }
.tagline { margin-top: .7mm; font-size: 6.1pt; line-height: 1.2; letter-spacing: .025em; color: #6b7280; font-weight: 600; }
.business-address { margin-top: 1.3mm; font-size: 6.7pt; line-height: 1.3; color: #4b5563; overflow-wrap: anywhere; }
.business-contact { margin-top: .6mm; font-size: 6.5pt; line-height: 1.3; color: #4b5563; overflow-wrap: anywhere; }
.rule { border-top: .35mm solid #111827; margin: 2.5mm 0; }
.rule-soft { border-top: .2mm dashed #9ca3af; margin: 1.8mm 0; }
.title { font-size: 8.2pt; line-height: 1.15; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.section { margin-top: 2.3mm; }
.section-title { margin-bottom: 1.2mm; font-size: 6.7pt; line-height: 1.1; font-weight: 850; letter-spacing: .085em; text-transform: uppercase; color: #374151; }
.meta-grid { display: grid; gap: .8mm; }
.meta-row, .amount-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 2mm; font-size: 6.8pt; line-height: 1.3; }
.meta-row span, .amount-row span { color: #6b7280; min-width: 0; }
.meta-row strong, .amount-row strong { max-width: 31mm; text-align: right; color: #111827; overflow-wrap: anywhere; }
.amount-row { margin-top: .9mm; }
.amount-row.discount strong { color: #111827; }
.renter-name { font-size: 8pt; line-height: 1.2; font-weight: 800; overflow-wrap: anywhere; }
.renter-contact { margin-top: .6mm; font-size: 6.8pt; color: #4b5563; }
.item { margin: 1.7mm 0; }
.item-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1.5mm; }
.item-heading { display: flex; align-items: flex-start; gap: 1mm; min-width: 0; max-width: 35mm; }
.item-kind { flex: 0 0 auto; margin-top: .1mm; padding: .35mm .7mm; border: .15mm solid #9ca3af; border-radius: .7mm; font-size: 5pt; line-height: 1.15; font-weight: 800; letter-spacing: .04em; }
.item-kind.jual { border-style: dashed; }
.item-name { min-width: 0; font-size: 6.8pt; line-height: 1.25; font-weight: 750; overflow-wrap: anywhere; }
.item-total { flex: 0 0 auto; max-width: 17mm; font-size: 7pt; line-height: 1.25; font-weight: 850; text-align: right; overflow-wrap: anywhere; }
.variant { font-weight: 500; color: #4b5563; }
.item-subrow { display: flex; justify-content: space-between; gap: 2mm; margin-top: .6mm; font-size: 6pt; line-height: 1.2; color: #6b7280; }
.item-subrow strong { flex: 0 0 auto; text-align: right; color: #4b5563; }
.item-subrow.promo strong { color: #111827; }
.item-meta { margin-top: .5mm; font-size: 6pt; color: #6b7280; line-height: 1.2; }
.summary { margin-top: 2.5mm; padding-top: 1.6mm; border-top: .25mm dashed #6b7280; }
.summary .amount-row { font-size: 6.9pt; }
.discount-heading { margin-top: 1.8mm; font-size: 6pt; font-weight: 800; letter-spacing: .07em; color: #6b7280; }
.total-box { margin-top: 2.1mm; padding: 2mm 0; border-top: .4mm solid #111827; border-bottom: .4mm solid #111827; }
.total-row { display: flex; align-items: baseline; justify-content: space-between; gap: 2mm; }
.total-label { font-size: 8pt; font-weight: 900; letter-spacing: .035em; }
.total-value { max-width: 29mm; font-size: 9.8pt; font-weight: 950; text-align: right; overflow-wrap: anywhere; }
.payment-section { padding-top: 1.5mm; border-top: .2mm dashed #9ca3af; }
.small-note { font-size: 6.1pt; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #4b5563; }
.small-note strong { color: #111827; font-weight: 900; }
.receipt-note { margin-top: 2mm; }
.receipt-note .section-title { text-transform: none; }
.qr-wrap { margin-top: 3mm; text-align: center; }
.qr { width: 24mm; height: 24mm; display: block; margin: 0 auto 1.3mm; image-rendering: crisp-edges; }
.qr-caption { font-size: 6.5pt; line-height: 1.2; font-weight: 850; letter-spacing: .08em; }
.footer-message { margin-top: 2.2mm; text-align: center; font-size: 6.7pt; line-height: 1.25; font-weight: 800; letter-spacing: .025em; }
.system-attribution { margin-top: 1.1mm; text-align: center; font-size: 5.1pt; line-height: 1.2; color: #6b7280; letter-spacing: .035em; }
@media screen { body { margin: 0 auto; } }
</style>
</head>
<body>
<main class="receipt">
  <header class="center">
    <img class="brand-logo" src="${escapeHtml(logoDataUrl || "/logo.webp")}" alt="Logo Akasha Outdoor" />
    <div class="brand">AKASHA OUTDOOR</div>
    <div class="tagline">ready for your wild journey</div>
    ${address}${contactHtml}
  </header>
  <div class="rule"></div>
  <section class="center"><div class="title">BUKTI TRANSAKSI</div></section>
  <section class="section">
    <div class="section-title">DETAIL TRANSAKSI & PENYEWA</div>
    <div class="renter-name">${escapeHtml(receipt.penyewa_nama)}</div>
    ${receipt.penyewa_telepon ? `<div class="renter-contact">${escapeHtml(receipt.penyewa_telepon)}</div>` : ""}
  </section>
  <section class="section">
    <div class="section-title">JADWAL PENYEWAAN</div>
    <div class="meta-grid">
      <div class="meta-row"><span>Mulai</span><strong>${escapeHtml(formatReceiptDateTime(receipt.jadwal_mulai, receipt.timezone))}</strong></div>
      <div class="meta-row"><span>Kembali</span><strong>${escapeHtml(formatReceiptDateTime(receipt.jadwal_kembali, receipt.timezone))}</strong></div>
      <div class="meta-row"><span>Toleransi</span><strong>${escapeHtml(formatReceiptDateTime(receipt.tolerance_deadline, receipt.timezone))}</strong></div>
    </div>
  </section>
  <section class="section">
    <div class="section-title">RINCIAN BARANG</div>
    <div class="rule-soft"></div>
    ${allLines || '<div class="item-meta">Tidak ada rincian barang.</div>'}
  </section>
  <section class="summary">
    <div class="section-title">RINGKASAN TRANSAKSI</div>
    <div class="amount-row"><span>Total Sewa + Beli</span><strong>${escapeHtml(formatReceiptMoney(Number(receipt.subtotal_rental ?? receipt.total_amount) + Number(receipt.subtotal_penjualan ?? 0), currency))}</strong></div>
    ${hasDiscount ? `<div class="discount-heading">DISKON</div>${discountRows}` : ""}
    <div class="total-box">
      <div class="total-row"><span class="total-label">TOTAL TRANSAKSI</span><span class="total-value">${escapeHtml(formatReceiptMoney(receipt.total_amount, currency))}</span></div>
    </div>
  </section>
  ${payment}${note}
  <div class="rule-soft"></div>
  ${qr}
  <div class="footer-message">Semoga perjalanan Anda menyenangkan.</div>
  <div class="system-attribution">Dicetak dengan Akasha Outdoor Management System</div>
</main>
</body>
</html>`;
}

/** Converts stored Indonesian mobile numbers to the international WhatsApp JID format. */
export function normalizeReceiptWhatsAppPhone(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const explicitInternational = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00") && digits.startsWith("00")) digits = digits.slice(2);
  else if (!explicitInternational && digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (!explicitInternational && digits.startsWith("8")) digits = `62${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

/** Backward-compatible alias; all receipt callers now use the canonical layout. */
export function buildThermalReceiptPrintHtml(receipt: RentalReceiptData, qrDataUrl: string) {
  return buildRentalReceiptHtml(receipt, qrDataUrl);
}

type AndroidPrintBridge = {
  printThermalHtml?: (html: string, documentName: string) => boolean;
};

export async function printHtmlDocument(
  html: string,
  options: { androidThermal?: boolean; documentName?: string } = {},
) {
  if (options.androidThermal) {
    const bridge = (window as Window & { AndroidInterface?: AndroidPrintBridge }).AndroidInterface;
    if (bridge) {
      if (typeof bridge.printThermalHtml !== "function") {
        throw new Error("Versi aplikasi Android belum mendukung pencetakan struk thermal. Pasang APK Rental Outdoor terbaru.");
      }
      const accepted = bridge.printThermalHtml(html, options.documentName ?? "Struk Penyewaan 58 mm");
      if (!accepted) throw new Error("Android tidak dapat menyiapkan pencetakan struk. Perbarui aplikasi lalu coba lagi.");
      return;
    }
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";

  await new Promise<void>((resolve, reject) => {
    iframe.onload = () => {
      const frameWindow = iframe.contentWindow;
      if (!frameWindow) {
        reject(new Error("Jendela cetak tidak tersedia."));
        return;
      }

      window.setTimeout(() => {
        try {
          frameWindow.focus();
          frameWindow.print();
          resolve();
        } catch (cause) {
          reject(cause instanceof Error ? cause : new Error("Perintah cetak gagal."));
        } finally {
          window.setTimeout(() => iframe.remove(), 1000);
        }
      }, 120);
    };

    iframe.onerror = () => {
      iframe.remove();
      reject(new Error("Dokumen cetak gagal disiapkan."));
    };

    document.body.appendChild(iframe);
    iframe.srcdoc = html;
  });
}

export type PrintLabelDocument = {
  labels: UnitQrLabelData[];
};

export function buildUnitQrPrintDocument(
  labels: UnitQrLabelData[],
  qrDataUrls: string[],
  options: Pick<UnitQrLabelOptions, "format" | "labelsPerPage"> = {},
) {
  if (labels.length !== qrDataUrls.length) throw new Error("Jumlah QR dan label tidak sama.");

  const format = options.format ?? "label";
  const labelsPerPage = Math.max(1, options.labelsPerPage ?? 8);
  const renderCard = (label: UnitQrLabelData, index: number, variant: "label" | "a4") => {
    if (variant === "label") {
      return `
    <article class="label">
      <div class="content">
        <div>
          <div class="code">${escapeHtml(label.kode_unit)}</div>
          <div class="name">${escapeHtml(label.nama_barang)}${label.nama_varian ? " · " + escapeHtml(label.nama_varian) : ""}</div>
          <div class="hint">Scan untuk membuka detail unit</div>
        </div>
        <img src="${qrDataUrls[index]}" alt="QR ${escapeHtml(label.kode_unit)}" />
      </div>
    </article>
      `;
    }

    return `
      <article class="label">
        <div class="content">
          <div class="copy">
            <div class="eyebrow">UNIT OUTDOOR</div>
            <div class="code">${escapeHtml(label.kode_unit)}</div>
            <div class="name">${escapeHtml(label.nama_barang)}${label.nama_varian ? " · " + escapeHtml(label.nama_varian) : ""}</div>
            <div class="hint">Scan untuk membuka detail unit</div>
          </div>
          <div class="qr-wrap">
            <img src="${qrDataUrls[index]}" alt="QR ${escapeHtml(label.kode_unit)}" />
            <div class="scan-label">QR Unit</div>
          </div>
        </div>
      </article>
    `;
  };

  if (format === "label") {
    const cards = labels.map((label, index) => renderCard(label, index, "label")).join("");

    return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>Label QR Unit</title>
<style>
@page { size: 50mm 30mm; margin: 0; }
html,body { margin: 0; padding: 0; background: #fff; }
.label { width: 50mm; height: 30mm; box-sizing: border-box; page-break-after: always; padding: 2.5mm; }
.content { height: 100%; display: grid; grid-template-columns: 1fr 22mm; gap: 2.5mm; align-items: center; }
.code { font: 700 10pt/1.1 Arial, sans-serif; }
.name { margin-top: 1.2mm; font: 8pt/1.2 Arial, sans-serif; }
.hint { margin-top: 4mm; font: 6pt/1.2 Arial, sans-serif; }
img { width: 22mm; height: 22mm; image-rendering: crisp-edges; }
</style>
</head>
<body>${cards}</body>
</html>`;
  }

  const pages: string[] = [];
  for (let start = 0; start < labels.length; start += labelsPerPage) {
    const pageLabels = labels.slice(start, start + labelsPerPage);
    const pageCards = pageLabels
      .map((label, localIndex) => renderCard(label, start + localIndex, "a4"))
      .join("");
    pages.push(`<section class="sheet">${pageCards}</section>`);
  }

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>Batch QR Unit A4</title>
<style>
@page { size: A4 portrait; margin: 10mm; }
html,body { margin: 0; padding: 0; background: #fff; }
body { font-family: Arial, sans-serif; color: #101828; }
.sheet {
  width: 190mm;
  min-height: 277mm;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(4, 64mm);
  gap: 5mm;
  break-after: page;
  page-break-after: always;
}
.sheet:last-child { break-after: auto; page-break-after: auto; }
.label {
  box-sizing: border-box;
  min-width: 0;
  border: 0.35mm solid #d0d5dd;
  border-radius: 5mm;
  padding: 6mm;
  background: #fff;
  overflow: hidden;
  break-inside: avoid;
  page-break-inside: avoid;
}
.content {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 45mm;
  gap: 5mm;
  align-items: center;
}
.copy { min-width: 0; }
.eyebrow {
  font-size: 7pt;
  line-height: 1;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #667085;
  font-weight: 700;
}
.code {
  margin-top: 3mm;
  font-size: 18pt;
  line-height: 1.05;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.name {
  margin-top: 3mm;
  font-size: 11pt;
  line-height: 1.25;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.hint {
  margin-top: 7mm;
  max-width: 50mm;
  font-size: 8pt;
  line-height: 1.35;
  color: #667085;
}
.qr-wrap {
  display: grid;
  justify-items: center;
  gap: 2mm;
}
img {
  width: 43mm;
  height: 43mm;
  display: block;
  image-rendering: crisp-edges;
}
.scan-label {
  font-size: 7pt;
  font-weight: 700;
  color: #475467;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
</style>
</head>
<body>${pages.join("")}</body>
</html>`;
}