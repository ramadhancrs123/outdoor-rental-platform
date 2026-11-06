import type { SaleReceiptData } from "./types";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g,(character)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;",
  }[character] ?? character));
}
function money(amount:number,currency:string) {
  return new Intl.NumberFormat("id-ID",{style:"currency",currency,maximumFractionDigits:0}).format(amount);
}
function dateTime(value:string,timezone:string) {
  return new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short",timeZone:timezone}).format(new Date(value));
}

export function buildSaleReceiptThermalHtml(receipt:SaleReceiptData, qrDataUrl?: string | null) {
  const renderLine=(line:{nama:string;rincian:string|null;jumlah:number;subtotal:number;unit_price?:number})=>`
    <article class="item">
      <div class="top"><strong>${escapeHtml(line.nama)}</strong><b>${escapeHtml(money(line.subtotal,receipt.currency_code))}</b></div>
      ${line.rincian ? `<div class="variant">${escapeHtml(line.rincian)}</div>` : ""}
      <div class="meta">${line.jumlah} × ${escapeHtml(money(line.unit_price ?? line.subtotal/Math.max(1,line.jumlah),receipt.currency_code))}</div>
    </article>`;
  const saleLines=receipt.lines.map(renderLine).join("");
  const rentalLines=(receipt.rental?.lines??[]).map(line=>renderLine({...line,unit_price:line.subtotal/Math.max(1,line.jumlah)})).join("");
  const contact=[receipt.usaha_telepon,receipt.usaha_email].filter(Boolean).join(" · ");
  const status=receipt.payment_status==="paid"?"LUNAS":receipt.payment_status==="partial"?"SEBAGIAN":"BELUM DIBAYAR";
  const rentalSection=receipt.rental?`
    <section class="section">PENYEWAAN · ${escapeHtml(receipt.rental.nomor_penyewaan)}</section>
    <div class="row"><span>Penyewa</span><b>${escapeHtml(receipt.rental.nama_penyewa)}</b></div>
    <div class="row"><span>Mulai</span><b>${escapeHtml(dateTime(receipt.rental.jadwal_mulai,receipt.timezone))}</b></div>
    <div class="row"><span>Kembali</span><b>${escapeHtml(dateTime(receipt.rental.jadwal_kembali,receipt.timezone))}</b></div>
    <div class="dash"></div>
    ${rentalLines}
    <div class="subtotal"><span>Subtotal Rental</span><b>${escapeHtml(money(receipt.rental.subtotal,receipt.currency_code))}</b></div>
    ${receipt.manual_discount_amount>0 ? `<div class="row"><span>Diskon Manual</span><b>−${escapeHtml(money(receipt.manual_discount_amount,receipt.currency_code))}</b></div>` : ""}
    ${receipt.loyalty_rental_discount_amount>0 ? `<div class="row"><span>Alokasi Loyalitas (Rental)</span><b>−${escapeHtml(money(receipt.loyalty_rental_discount_amount,receipt.currency_code))}</b></div>` : ""}
    ${qrDataUrl ? '<div class="qr"><img src="'+qrDataUrl+'" alt="QR penyewaan"/><span>SCAN UNTUK DETAIL PENYEWAAN</span></div>' : ''}
    <div class="dash"></div>`: "";
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"/><title>Struk ${escapeHtml(receipt.nomor_checkout)}</title>
  <style>
  @page{size:58mm auto;margin:0}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#111827;font-family:Arial,Helvetica,sans-serif}
  body{width:58mm}
  main{width:52mm;margin:0 auto;padding:3.5mm 0 5mm}
  .center{text-align:center}.brand{font-size:10pt;font-weight:900;letter-spacing:.04em}
  .muted{font-size:6.8pt;line-height:1.35;color:#4b5563;margin-top:1mm}
  .rule{border-top:.35mm solid #111827;margin:3mm 0}
  .dash{border-top:.2mm dashed #6b7280;margin:2.5mm 0}
  .title{font-size:9pt;font-weight:800;letter-spacing:.08em}
  .number{font-size:10pt;font-weight:900;margin-top:1mm}
  .section{font-size:7pt;font-weight:900;letter-spacing:.1em;margin:3mm 0 1.5mm}
  .row{display:flex;justify-content:space-between;gap:3mm;font-size:7pt;line-height:1.4;margin:1mm 0}
  .row span,.subtotal span{color:#6b7280}.row b{text-align:right}
  .item{margin:2.5mm 0}.top{display:flex;justify-content:space-between;gap:2mm;font-size:7.2pt;line-height:1.3}
  .top strong{max-width:34mm}.top b{white-space:nowrap}.variant,.meta{font-size:6.6pt;color:#6b7280;margin-top:.8mm;line-height:1.25}
  .subtotal{display:flex;justify-content:space-between;gap:2mm;font-size:7pt;margin:2mm 0 1mm}
  .total{border-top:.35mm solid #111827;border-bottom:.35mm solid #111827;padding:2.5mm 0;margin-top:3mm}
  .total .row{font-size:8pt;font-weight:900}.total .row b{font-size:10pt}
  .footer{margin-top:4mm;text-align:center;font-size:7pt;font-weight:800;letter-spacing:.04em}
  .qr{display:flex;flex-direction:column;align-items:center;gap:1mm;margin:2.5mm 0}.qr img{width:25mm;height:25mm;image-rendering:pixelated}.qr span{font-size:6pt;font-weight:700;letter-spacing:.04em}
  </style></head><body><main>
    <header class="center"><div class="brand">${escapeHtml(receipt.usaha_nama)}</div>
    ${receipt.usaha_alamat?'<div class="muted">'+escapeHtml(receipt.usaha_alamat)+'</div>':""}
    ${contact?'<div class="muted">'+escapeHtml(contact)+'</div>':""}</header>
    <div class="rule"></div>
    <section class="center"><div class="title">${receipt.rental?"BUKTI CHECKOUT":"BUKTI PENJUALAN"}</div><div class="number">${escapeHtml(receipt.nomor_checkout)}</div><div class="muted">${escapeHtml(receipt.nomor_penjualan)}</div></section>
    <section class="section">TRANSAKSI</section>
    <div class="row"><span>Tanggal</span><b>${escapeHtml(dateTime(receipt.tanggal,receipt.timezone))}</b></div>
    <div class="row"><span>Pelanggan</span><b>${escapeHtml(receipt.nama_pelanggan||"Pelanggan Umum")}</b></div>
    ${receipt.nomor_telepon?'<div class="row"><span>Telepon</span><b>'+escapeHtml(receipt.nomor_telepon)+'</b></div>':""}
    <div class="dash"></div>
    ${rentalSection}
    <section class="section">PEMBELIAN · ${escapeHtml(receipt.nomor_penjualan)}</section>
    ${saleLines}
    <div class="subtotal"><span>Subtotal Pembelian</span><b>${escapeHtml(money(receipt.sale_subtotal,receipt.currency_code))}</b></div>
    ${receipt.sale_discount_amount>0 ? `<div class="row"><span>Alokasi Loyalitas (Pembelian)</span><b>−${escapeHtml(money(receipt.sale_discount_amount,receipt.currency_code))}</b></div>` : ""}
    <div class="total"><div class="row"><span>TOTAL CHECKOUT</span><b>${escapeHtml(money(receipt.total_amount,receipt.currency_code))}</b></div></div>
    <section class="section">PEMBAYARAN</section>
    <div class="row"><span>Status</span><b>${status}</b></div>
    <div class="row"><span>Diterima</span><b>${escapeHtml(money(receipt.amount_paid,receipt.currency_code))}</b></div>
    <div class="row"><span>Sisa</span><b>${escapeHtml(money(Math.max(0,receipt.total_amount-receipt.amount_paid),receipt.currency_code))}</b></div>
    <div class="dash"></div><div class="footer">TERIMA KASIH · SELAMAT BERAKTIVITAS</div>
    <div class="muted center">Simpan struk ini sebagai bukti transaksi.</div>
  </main></body></html>`;
}
