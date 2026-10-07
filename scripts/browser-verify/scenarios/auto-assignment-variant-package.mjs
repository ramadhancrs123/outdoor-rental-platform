async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}

function localValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate())+
    "T"+pad(date.getHours())+":"+pad(date.getMinutes());
}

async function setPeriod(page) {
  await page.getByRole("button", { name: /Lanjut ke periode/i }).click();
  const inputs = page.locator('input[type="datetime-local"]');
  await inputs.nth(0).fill(localValue(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  await inputs.nth(1).fill(localValue(new Date(Date.now() + 26 * 60 * 60 * 1000)));
  await page.getByRole("button", { name: /Lanjut ke barang/i }).click();
}

async function selectQaRenter(page) {
  const existing = page.getByRole("button").filter({ hasText: /QA Auto Assignment/i }).first();
  if (await existing.count()) {
    await existing.click();
    return;
  }

  await page.getByRole("button", { name: /Tambah penyewa/i }).click();
  const dialog = page.getByRole("dialog", { name: "Tambah penyewa baru" });
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await dialog.getByLabel("Nama lengkap penyewa").fill("QA Auto Assignment");
  await dialog.getByLabel("Nomor telepon penyewa").fill("0800-QA-AUTO-ASSIGN");
  await dialog.getByRole("button", { name: /Buat dan pilih penyewa/i }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
}

export default async function autoAssignmentVariantPackage({ page, baseURL, capture }) {
  await page.goto(baseURL + "/penyewaan/walk-in", { waitUntil: "domcontentloaded" });
  await settle(page);
  await selectQaRenter(page);
  await setPeriod(page);

  await page.getByRole("button", { name: /Carrier Eiger 40L/i }).click();
  await page.getByRole("button", { name: "Eiger-cream", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Jumlah unit" }).fill("1");
  await page.getByRole("button", { name: "Tambahkan", exact: true }).click();
  await page.getByRole("button", { name: "Review Transaksi", exact: true }).click();
  await page.getByRole("button", { name: "Buat Draf Penyewaan", exact: true }).click();
  await page.waitForURL(/\/penyewaan\//, { timeout: 15000 });
  await page.getByText(/Penetapan unit/i).first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2000);
  await settle(page);

  const bodyBefore = await page.locator("body").innerText();
  if (!bodyBefore.includes("Tetapkan Otomatis")) throw new Error("Aksi semi-otomatis tidak muncul pada rental variant. body=" + bodyBefore.slice(-5000));
  if (!bodyBefore.includes("Pilih & Serahkan Barang")) throw new Error("Aksi manual tetap tidak tersedia pada rental variant.");

  await page.getByRole("button", { name: "Tetapkan Otomatis", exact: true }).click();
  await page.waitForTimeout(1000);
  await settle(page);

  const bodyAfter = await page.locator("body").innerText();
  if (!bodyAfter.includes("1 unit berhasil ditetapkan otomatis")) {
    throw new Error("Feedback auto assignment variant tidak muncul. body=" + bodyAfter.slice(-4500));
  }
  if (!bodyAfter.includes("Lengkap")) throw new Error("Assignment variant belum menunjukkan status Lengkap.");
  if (!bodyAfter.includes("Selesaikan Serah-terima")) {
    throw new Error("Rental langsung berubah aktif atau tombol serah-terima hilang setelah auto assignment.");
  }
  const variantRentalUrl = page.url();
  const variantRentalNumber = await page.getByRole("heading", { level: 1 }).innerText();

  await page.goto(baseURL + "/penyewaan", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByText(variantRentalNumber, { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByText(variantRentalNumber, { exact: true }).waitFor({ state: "visible", timeout: 10000 });

  await page.goto(variantRentalUrl, { waitUntil: "domcontentloaded" });
  await settle(page);
  await capture("auto-assign-variant");

  await page.goto(baseURL + "/penyewaan/walk-in", { waitUntil: "domcontentloaded" });
  await settle(page);
  await selectQaRenter(page);
  await setPeriod(page);
  await page.getByRole("button", { name: "Paket", exact: true }).click();
  await page.getByRole("button", { name: "Paket camping sederhana", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Jumlah paket" }).fill("1");
  await page.getByRole("button", { name: "Tambahkan paket", exact: true }).click();
  await page.getByRole("button", { name: "Review Transaksi", exact: true }).click();
  await page.getByRole("button", { name: "Buat Draf Penyewaan", exact: true }).click();
  await page.waitForURL(/\/penyewaan\//, { timeout: 15000 });
  await page.getByText(/Penetapan unit/i).first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2000);
  await settle(page);

  const packageBodyBefore = await page.locator("body").innerText();
  if (!packageBodyBefore.includes("Tetapkan Semua Otomatis")) throw new Error("Aksi auto assignment package tidak muncul.");
  if (!packageBodyBefore.includes("Pilih unit ready")) throw new Error("Pilihan manual unit package tidak tersedia.");

  await page.getByRole("button", { name: "Tetapkan Semua Otomatis", exact: true }).click();
  await page.waitForTimeout(1500);
  await settle(page);

  const packageBodyAfter = await page.locator("body").innerText();
  if (!packageBodyAfter.includes("unit berhasil ditetapkan otomatis")) {
    throw new Error("Feedback auto assignment package tidak muncul.");
  }
  const assignedMatches = [...packageBodyAfter.matchAll(/Assigned (\d+) ·/g)].map((m) => Number(m[1]));
  if (!assignedMatches.length || assignedMatches.reduce((a, b) => a + b, 0) < 8) {
    throw new Error("Package belum menetapkan seluruh 8 physical units. observed=" + JSON.stringify(assignedMatches));
  }
  if (!packageBodyAfter.includes("Selesaikan Serah-terima")) {
    throw new Error("Package auto assignment tidak tetap pada tahap sebelum pickup.");
  }
  await capture("auto-assign-package");

  return {
    state: "VERIFIED",
    variantRentalUrl,
    packageAssignedTotal: assignedMatches.reduce((a, b) => a + b, 0),
    manualAssignmentStillAvailable: true,
  };
}
