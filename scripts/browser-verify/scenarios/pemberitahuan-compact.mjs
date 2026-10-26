export default async function pemberitahuanCompact({ page, capture }) {
  await page.getByRole("heading", { name: "Pemberitahuan", exact: true }).waitFor({ state: "visible", timeout: 20000 });

  const rowCount = await page.locator("article[data-notification-id]").count();
  const metrics = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("article[data-notification-id]"));
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      rowCount: rows.length,
      rowMetrics: rows.slice(0, 5).map((row) => {
        const style = window.getComputedStyle(row);
        const rect = row.getBoundingClientRect();
        return {
          height: Math.round(rect.height),
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          borderRadius: style.borderRadius,
        };
      }),
    };
  });

  if (metrics.documentWidth > metrics.viewportWidth + 1 || metrics.bodyWidth > metrics.viewportWidth + 1) {
    throw new Error("Pemberitahuan menyebabkan horizontal overflow: " + JSON.stringify(metrics));
  }
  if (metrics.rowCount !== rowCount) throw new Error("Jumlah baris pemberitahuan berubah saat pemeriksaan.");

  const compactRows = metrics.rowMetrics.every((row) => parseFloat(row.paddingTop) <= 13 && parseFloat(row.paddingBottom) <= 13);
  if (!compactRows) throw new Error("Baris pemberitahuan belum compact: " + JSON.stringify(metrics.rowMetrics));

  const permintaanLinkCount = await page.getByRole("link", { name: /^Permintaan$/ }).count();
  if (metrics.viewportWidth >= 768 && permintaanLinkCount > 0) {
    throw new Error("Menu Permintaan masih terlihat di sidebar desktop.");
  }

  await capture("pemberitahuan-compact");
  return {
    state: "VERIFIED",
    route: "/pemberitahuan",
    viewportWidth: metrics.viewportWidth,
    notificationRows: rowCount,
    compactRowSpacing: compactRows,
    horizontalOverflow: false,
    permintaanSidebarVisible: metrics.viewportWidth >= 768 ? permintaanLinkCount > 0 : null,
  };
}
