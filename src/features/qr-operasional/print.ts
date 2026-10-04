import type { RentalReceiptData, UnitQrLabelData, UnitQrLabelOptions } from "./types";

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

export function buildThermalReceiptPrintHtml(
  receipt: RentalReceiptData,
  qrDataUrl: string,
) {
  const lines = receipt.lines.map((line) =>
    '<div class="item">' +
      '<div class="item-top">' +
        '<div class="item-name">' + escapeHtml(line.nama) + (line.rincian ? ' <span class="variant">· ' + escapeHtml(line.rincian) + '</span>' : '') + '</div>' +
        '<div class="item-total">' + escapeHtml(formatReceiptMoney(line.subtotal, line.currency_code)) + '</div>' +
      '</div>' +
      '<div class="item-meta">' + line.jumlah + ' × ' + escapeHtml(formatReceiptMoney(line.subtotal / Math.max(line.jumlah, 1), line.currency_code)) + '</div>' +
    '</div>'
  ).join('');

  const payment = receipt.pembayaran
    ? '<section class="section">' +
        '<div class="section-title">PEMBAYARAN</div>' +
        '<div class="payment-row"><span>Status</span><strong>' + paymentLabel(receipt.pembayaran.status) + '</strong></div>' +
        '<div class="payment-row"><span>Tercatat</span><strong>' + escapeHtml(formatReceiptMoney(receipt.pembayaran.tercatat, receipt.currency_code)) + '</strong></div>' +
        '<div class="payment-row"><span>Sisa</span><strong>' + escapeHtml(formatReceiptMoney(receipt.pembayaran.sisa, receipt.currency_code)) + '</strong></div>' +
      '</section>'
    : '';

  const contact = [receipt.usaha_telepon, receipt.usaha_email].filter(Boolean).join('  ·  ');
  const address = receipt.usaha_alamat ? '<div class="business-address">' + escapeHtml(receipt.usaha_alamat) + '</div>' : '';
  const contactHtml = contact ? '<div class="business-contact">' + escapeHtml(contact) + '</div>' : '';
  const pickup = receipt.actual_pickup_at
    ? '<div class="meta-row"><span>Serah-terima</span><strong>' + escapeHtml(formatReceiptDateTime(receipt.actual_pickup_at, receipt.timezone)) + '</strong></div>'
    : '';
  const note = receipt.catatan
    ? '<section class="section"><div class="section-title">CATATAN</div><div class="small-note">' + escapeHtml(receipt.catatan) + '</div></section>'
    : '';

  return '<!doctype html>\n' +
'<html lang="id">\n<head>\n' +
'<meta charset="utf-8" />\n' +
'<title>Bukti Penyewaan ' + escapeHtml(receipt.nomor_penyewaan) + '</title>\n' +
'<style>\n' +
'@page { size: 58mm auto; margin: 0; }\n' +
'html, body { margin: 0; padding: 0; background: #fff; }\n' +
'body { width: 58mm; color: #111827; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n' +
'.receipt { width: 52mm; margin: 0 auto; padding: 3.5mm 0 5mm; box-sizing: border-box; }\n' +
'.center { text-align: center; }\n' +
'.brand { font-size: 10.2pt; line-height: 1.1; font-weight: 900; letter-spacing: .055em; white-space: nowrap; }\n' +
'.business-type { margin-top: 1.2mm; font-size: 7.3pt; line-height: 1.2; text-transform: uppercase; letter-spacing: .18em; color: #374151; font-weight: 800; }\n' +
'.tagline { margin-top: .8mm; font-size: 6.4pt; line-height: 1.3; letter-spacing: .025em; color: #6b7280; font-weight: 600; }\n' +
'.business-address { margin-top: 1.6mm; font-size: 7pt; line-height: 1.35; color: #4b5563; }\n' +
'.business-contact { margin-top: .8mm; font-size: 6.7pt; line-height: 1.35; color: #4b5563; }\n' +
'.rule { border-top: .35mm solid #111827; margin: 3mm 0; }\n' +
'.rule-soft { border-top: .2mm dashed #6b7280; margin: 2.8mm 0; }\n' +
'.title { font-size: 9pt; line-height: 1.15; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }\n' +
'.rental-no { margin-top: 1.2mm; font-size: 10.5pt; line-height: 1.1; font-weight: 800; }\n' +
'.section { margin-top: 3mm; }\n' +
'.section-title { margin-bottom: 1.7mm; font-size: 7pt; line-height: 1.1; font-weight: 800; letter-spacing: .11em; text-transform: uppercase; color: #374151; }\n' +
'.meta-grid { display: grid; gap: 1.2mm; }\n' +
'.meta-row, .payment-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 3mm; font-size: 7.2pt; line-height: 1.35; }\n' +
'.meta-row span, .payment-row span { color: #6b7280; }\n' +
'.meta-row strong, .payment-row strong { text-align: right; color: #111827; }\n' +
'.renter-name { font-size: 8.8pt; line-height: 1.2; font-weight: 750; }\n' +
'.renter-contact { margin-top: .8mm; font-size: 7pt; color: #4b5563; }\n' +
'.item { margin: 2.5mm 0; }\n' +
'.item-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 3mm; }\n' +
'.item-name { max-width: 34mm; font-size: 7.5pt; line-height: 1.3; font-weight: 750; }\n' +
'.variant { font-weight: 500; color: #4b5563; }\n' +
'.item-total { flex: 0 0 auto; font-size: 7.7pt; line-height: 1.3; font-weight: 800; text-align: right; white-space: nowrap; }\n' +
'.item-meta { margin-top: .9mm; font-size: 6.7pt; color: #6b7280; line-height: 1.2; }\n' +
'.total-box { margin-top: 2.8mm; padding: 2.4mm 0; border-top: .35mm solid #111827; border-bottom: .35mm solid #111827; }\n' +
'.total-row { display: flex; align-items: baseline; justify-content: space-between; gap: 3mm; }\n' +
'.total-label { font-size: 8.3pt; font-weight: 800; letter-spacing: .05em; }\n' +
'.total-value { font-size: 11pt; font-weight: 900; white-space: nowrap; }\n' +
'.qr-wrap { margin-top: 4mm; text-align: center; }\n' +
'.qr { width: 29mm; height: 29mm; display: block; margin: 0 auto 2mm; image-rendering: crisp-edges; }\n' +
'.qr-caption { font-size: 7pt; line-height: 1.25; font-weight: 800; letter-spacing: .09em; }\n' +
'.qr-number { margin-top: .8mm; font-size: 7pt; line-height: 1.2; font-weight: 700; }\n' +
'.footer-message { margin-top: 3mm; text-align: center; font-size: 6.7pt; line-height: 1.35; font-weight: 800; letter-spacing: .08em; }\n' +
'.generated { margin-top: 2mm; text-align: center; font-size: 5.8pt; line-height: 1.25; color: #9ca3af; }\n' +
'.small-note { font-size: 6.8pt; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }\n' +
'</style>\n</head>\n<body>\n' +
'<main class="receipt">\n' +
'<header class="center">\n' +
'<div class="brand">AKASHA OUTDOOR RENT</div>\n' +
'<div class="tagline">ready for your wild journey</div>\n' + address + contactHtml + '\n' +
'</header>\n' +
'<div class="rule"></div>\n' +
'<section class="center"><div class="title">BUKTI PENYEWAAN</div><div class="rental-no">' + escapeHtml(receipt.nomor_penyewaan) + '</div></section>\n' +
'<section class="section"><div class="section-title">PERIODE PENYEWAAN</div><div class="meta-grid">' +
'<div class="meta-row"><span>Mulai</span><strong>' + escapeHtml(formatReceiptDateTime(receipt.jadwal_mulai, receipt.timezone)) + '</strong></div>' +
'<div class="meta-row"><span>Berakhir</span><strong>' + escapeHtml(formatReceiptDateTime(receipt.jadwal_kembali, receipt.timezone)) + '</strong></div>' +
'<div class="meta-row"><span>Toleransi</span><strong>' + escapeHtml(formatReceiptDateTime(receipt.tolerance_deadline, receipt.timezone)) + '</strong></div>' + pickup +
'</div></section>\n' +
'<section class="section"><div class="section-title">PENYEWA</div><div class="renter-name">' + escapeHtml(receipt.penyewa_nama) + '</div>' + (receipt.penyewa_telepon ? '<div class="renter-contact">' + escapeHtml(receipt.penyewa_telepon) + '</div>' : '') + '</section>\n' +
'<section class="section"><div class="section-title">PERLENGKAPAN</div><div class="rule-soft"></div>' + (lines || '<div class="item-meta">Tidak ada perlengkapan.</div>') + '</section>\n' +
'<div class="total-box"><div class="total-row"><span class="total-label">TOTAL PENYEWAAN</span><span class="total-value">' + escapeHtml(formatReceiptMoney(receipt.total_amount, receipt.currency_code)) + '</span></div></div>\n' +
payment + note +
'<div class="rule-soft"></div>\n' +
'<div class="qr-wrap"><img class="qr" src="' + qrDataUrl + '" alt="QR Penyewaan" /><div class="qr-caption">QR PENYEWAAN</div><div class="qr-number">' + escapeHtml(receipt.nomor_penyewaan) + '</div></div>\n' +
'<div class="footer-message">SEMOGA PERJALANAN ANDA MENYENANGKAN</div>\n' +
'<div class="generated">Dicetak ' + escapeHtml(formatReceiptDateTime(receipt.generated_at, receipt.timezone)) + '</div>\n' +
'</main>\n</body>\n</html>';
}

export async function printHtmlDocument(html: string) {
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