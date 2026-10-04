export default async function inventoryUiReference({ page, capture }) {
  const viewport = page.viewportSize();
  const overflowMetrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, bodyScrollWidth: document.body.scrollWidth }));
  const overflow = overflowMetrics.scrollWidth > overflowMetrics.clientWidth;
  if (overflow) {
    const offenders = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName,
            cls: String(el.className || "").slice(0, 180),
            x: Math.round(rect.x),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 100),
          };
        })
        .filter((item) => item.right > window.innerWidth + 1 || item.scrollWidth > item.clientWidth + 1)
        .sort((a, b) => b.right - a.right || b.scrollWidth - a.scrollWidth)
        .slice(0, 12),
    );
    throw new Error("Horizontal overflow pada inventaris: " + JSON.stringify({ ...overflowMetrics, offenders }));
  }
  const visible = async (name) => page.getByText(name, { exact: true }).first().isVisible().catch(() => false);
  const checks = {};
  for (const name of [
    "Inventaris","Unit Barang","Daftarkan Unit","Kelola Lokasi","Pindai QR",
    "Unit","Paket","Filter","CARR-060-CRM-001","CARR-060-BLK-004","CARR-060-BLK-003",
    "CARR-060-BLK-002","CARR-060-BLK-001","Siap disewakan","Belum ditentukan",
    "Belum dicatat","Lihat detail","5 unit"
  ]) checks[name] = await visible(name);
  const required = [
    "Inventaris","Unit Barang","Daftarkan Unit","Kelola Lokasi","Pindai QR",
    "Unit","Paket","Cari kode unit, serial, barang, varian, ...",

  ];
  const missing = required.filter((name) => !checks[name] && name !== "Cari kode unit, serial, barang, varian, ...");
  const searchVisible = await page.getByPlaceholder("Cari kode unit, serial, barang, varian, ...").isVisible().catch(() => false);
  if (!searchVisible) missing.push("Cari kode unit, serial, barang, varian, ...");
  if (viewport.width < 1024 && !(await visible("Filter"))) missing.push("Filter");
  if (viewport.width < 1024 && !(await visible("Lihat detail"))) missing.push("Lihat detail");
  if (missing.length) throw new Error("Visual contract inventaris gagal: elemen wajib tidak terlihat: " + missing.join(", "));
  await capture("inventory-reference");
  return { state: "VERIFIED", viewport, overflow: false, checks };
}
