export default async function scenario({ page, capture }) {
  if (page.url().includes("/login")) return { state: "BLOCKED_AUTH" };
  await page.getByRole("button", { name: /^QR$/ }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: /^QR$/ }).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
  if (!(await page.getByRole("dialog").getByText("QR Penyewaan", { exact: true }).count())) throw new Error("Preview QR Penyewaan tidak muncul.");
  if (!(await page.getByRole("dialog").getByText(/Nota dan cetak thermal belum termasuk/i).count())) throw new Error("Batas scope nota thermal tidak jelas.");
  await capture("qr-rental-detail-ui");
  return { state: "VERIFIED" };
}
