import type { RentalReceiptData, UnitQrLabelData, UnitQrLabelOptions } from "./types";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildThermalReceiptPrintHtml(
  receipt: RentalReceiptData,
  qrDataUrl: string,
) {
  const lines = receipt.lines.map((line) => `
    <div class="line">
      <div class="name">${escapeHtml(line.nama)}${line.rincian ? " · " + escapeHtml(line.rincian) : ""}</div>
      <div class="meta">${line.jumlah} x ${escapeHtml(new Intl.NumberFormat("id-ID", { style: "currency", currency: line.currency_code, maximumFractionDigits: 0 }).format(line.subtotal / Math.max(line.jumlah, 1)))}</div>
      <div class="subtotal">${escapeHtml(new Intl.NumberFormat("id-ID", { style: "currency", currency: line.currency_code, maximumFractionDigits: 0 }).format(line.subtotal))}</div>
    </div>
  `).join("");

  const payment = receipt.pembayaran
    ? `
      <div class="divider"></div>
      <div>Pembayaran tercatat</div>
      <strong>${escapeHtml(new Intl.NumberFormat("id-ID", { style: "currency", currency: receipt.currency_code, maximumFractionDigits: 0 }).format(receipt.pembayaran.tercatat))}</strong>
      <div>Sisa ${escapeHtml(new Intl.NumberFormat("id-ID", { style: "currency", currency: receipt.currency_code, maximumFractionDigits: 0 }).format(receipt.pembayaran.sisa))}</div>
    `
    : "";

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>Nota ${escapeHtml(receipt.nomor_penyewaan)}</title>
<style>
@page { size: 58mm auto; margin: 0; }
html,body { margin: 0; padding: 0; background: #fff; }
body { width: 58mm; font-family: Arial, sans-serif; font-size: 10pt; color: #000; }
.receipt { width: 52mm; margin: 3mm auto; }
.center { text-align: center; }
.title { font-weight: 700; font-size: 12pt; }
.small { font-size: 8pt; }
.divider { border-top: 1px dashed #000; margin: 3mm 0; }
.line { margin: 2.5mm 0; }
.name { font-weight: 700; }
.meta,.small { font-size: 8pt; }
.subtotal { font-weight: 700; margin-top: 1mm; }
.total { display: flex; justify-content: space-between; font-weight: 700; font-size: 11pt; }
.qr { width: 26mm; height: 26mm; object-fit: contain; display: block; margin: 5mm auto 2mm; }
.note { white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<main class="receipt">
  <div class="center title">AKASHA STORE</div>
  <div class="center">NOTA PENYEWAAN</div>
  <div class="divider"></div>
  <div>No. ${escapeHtml(receipt.nomor_penyewaan)}</div>
  <div>Penyewa: ${escapeHtml(receipt.penyewa_nama)}</div>
  <div class="small">Mulai: ${escapeHtml(new Date(receipt.jadwal_mulai).toLocaleString("id-ID"))}</div>
  <div class="small">Kembali: ${escapeHtml(new Date(receipt.jadwal_kembali).toLocaleString("id-ID"))}</div>
  <div class="divider"></div>
  ${lines}
  <div class="divider"></div>
  <div class="total"><span>TOTAL</span><span>${escapeHtml(new Intl.NumberFormat("id-ID", { style: "currency", currency: receipt.currency_code, maximumFractionDigits: 0 }).format(receipt.total_amount))}</span></div>
  ${payment}
  ${receipt.catatan ? `<div class="divider"></div><div class="small note">${escapeHtml(receipt.catatan)}</div>` : ""}
  <img class="qr" src="${qrDataUrl}" alt="QR detail penyewaan" />
  <div class="center small">Scan untuk membuka detail penyewaan</div>
</main>
</body>
</html>`;
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