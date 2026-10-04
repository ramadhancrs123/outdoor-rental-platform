async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

function localValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate())+"T"+pad(date.getHours())+":"+pad(date.getMinutes());
}

export default async function autoAssignPackageOnly({ page, baseURL, capture }) {
  await page.goto(baseURL + "/penyewaan/walk-in", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByRole("button", { name: /Tambah penyewa/i }).click();
  const dialog = page.getByRole("dialog", { name: "Tambah penyewa baru" });
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await dialog.getByLabel("Nama lengkap penyewa").fill("QA Package Auto");
  await dialog.getByLabel("Nomor telepon penyewa").fill("0800-QA-PACKAGE");
  await dialog.getByRole("button", { name: /Buat dan pilih penyewa/i }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  await page.getByRole("button", { name: /Lanjut ke periode/i }).click();

  const inputs = page.locator('input[type="datetime-local"]');
  await inputs.nth(0).fill(localValue(new Date(Date.now()+2*60*60*1000)));
  await inputs.nth(1).fill(localValue(new Date(Date.now()+26*60*60*1000)));
  await page.getByRole("button", { name: /Lanjut ke barang/i }).click();
  await page.getByRole("button", { name: "Paket", exact: true }).click();
  await page.waitForTimeout(1500);

  const packageCards = page.getByRole("button").filter({ hasText: /(?:\d+ siap|Belum siap)/i });
  const availableCards = packageCards.filter({ hasText: /[1-9]\d* siap/ });
  const availableCount = await availableCards.count();
  if (!availableCount) {
    throw new Error("Tidak ada paket yang dilaporkan siap di UI. body=" + (await page.locator("body").innerText()).slice(-5000));
  }

  await availableCards.first().click();
  const addPackage = page.getByRole("button", { name: "Tambahkan paket", exact: true });
  await addPackage.waitFor({ state: "visible", timeout: 10000 });
  if (await addPackage.isDisabled()) {
    throw new Error("Paket terlihat siap tetapi Tambahkan paket tetap disabled.");
  }

  await page.getByRole("spinbutton", { name: "Jumlah paket" }).fill("1");
  await page.waitForTimeout(2500);
  if (await addPackage.isDisabled()) {
    throw new Error("Paket add masih disabled setelah menunggu. body=" + (await page.locator("body").innerText()).slice(-7000));
  }
  await addPackage.click();
  await page.getByText(/line/, { exact: false }).first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await page.getByRole("button", { name: "Review Transaksi", exact: true }).click();
  await page.getByRole("button", { name: "Buat Draf Penyewaan", exact: true }).click();
  await page.waitForURL(/\/penyewaan\//, { timeout: 15000 });
  await page.getByText(/Penetapan unit/i).first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2000);
  await settle(page);

  const before = await page.locator("body").innerText();
  if (!before.includes("Tetapkan Semua Otomatis")) {
    throw new Error("Aksi auto assignment package tidak muncul. body=" + before.slice(-5000));
  }

  await page.getByRole("button", { name: "Tetapkan Semua Otomatis", exact: true }).click();
  await page.waitForTimeout(2500);
  await settle(page);
  const after = await page.locator("body").innerText();

  const assigned = [...after.matchAll(/Assigned (\d+) ·/g)].map((m) => Number(m[1]));
  if (!assigned.length || assigned.reduce((a,b)=>a+b,0) < 8) {
    throw new Error("Package belum seluruhnya ter-assign otomatis. assigned=" + JSON.stringify(assigned) + " body=" + after.slice(-6000));
  }
  if (!after.includes("Selesaikan Serah-terima")) {
    throw new Error("Package tidak tetap pada state menunggu pickup.");
  }
  await capture("auto-assigned-package");

  return { state: "VERIFIED", assignedTotal: assigned.reduce((a,b)=>a+b,0), availablePackageCards: availableCount };
}
