export default async function penyewaanWalkInScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return {
      state: "BLOCKED_AUTH",
      reason: "Route Walk-in dilindungi Authenticated dan browser tidak memiliki sesi admin.",
    };
  }

  const heading = page.getByRole("heading", { name: "Buat Penyewaan Langsung" });
  await heading.waitFor({ state: "visible", timeout: 10000 });
  await capture("walk-in-initial");

  for (const label of ["Penyewa", "Periode", "Barang", "Tinjau"]) {
    await page.getByText(label, { exact: true }).first().waitFor({ state: "visible", timeout: 3000 });
  }

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (horizontalOverflow) throw new Error("Walk-in memiliki horizontal overflow pada viewport ini.");

  await page.getByRole("button", { name: /Tambah penyewa/i }).waitFor({ state: "visible", timeout: 5000 });
  await page.getByRole("button", { name: /Tambah penyewa/i }).click();
  await page.getByRole("dialog", { name: "Tambah penyewa baru" }).waitFor({ state: "visible", timeout: 5000 });
  await capture("walk-in-renter-dialog");

  if (!(await page.getByRole("button", { name: /Buat dan pilih penyewa/i }).isDisabled())) {
    throw new Error("Tombol Buat dan pilih penyewa seharusnya disabled saat form penyewa kosong.");
  }

  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Tambah penyewa baru" }).waitFor({ state: "hidden", timeout: 5000 });
  await page.getByRole("button", { name: /Lanjut ke periode/i }).waitFor({ state: "visible", timeout: 5000 });

  const renterChoice = page.getByRole("button").filter({ hasText: /Ahmad Fauzi/i }).first();
  if (!(await renterChoice.count())) {
    return { state: "BLOCKED_FIXTURE", reason: "Fixture penyewa Ahmad Fauzi tidak tersedia." };
  }
  await renterChoice.click();
  await page.getByRole("button", { name: /Lanjut ke periode/i }).click();

  const periodInputs = page.locator('input[type="datetime-local"]');
  if ((await periodInputs.count()) < 2) throw new Error("Input periode rental tidak ditemukan.");

  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
  const localValue = (value) => {
    const pad = (n) => String(n).padStart(2, "0");
    return value.getFullYear() + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate()) +
      "T" + pad(value.getHours()) + ":" + pad(value.getMinutes());
  };
  await periodInputs.nth(0).fill(localValue(start));
  await periodInputs.nth(1).fill(localValue(end));
  await page.getByText(/Batas toleransi pengembalian/i).first().waitFor({ state: "visible", timeout: 5000 });
  const nextProductButton = page.getByRole("button", { name: /Lanjut ke barang/i });
  if (await nextProductButton.isDisabled()) {
    throw new Error(`Tombol Lanjut ke barang masih disabled. start=${await periodInputs.nth(0).inputValue()} end=${await periodInputs.nth(1).inputValue()}`);
  }

  const policyButton = page.getByRole("button", { name: "Ubah", exact: true });
  await policyButton.waitFor({ state: "visible", timeout: 5000 });
  await policyButton.click();
  const policyDialog = page.getByRole("dialog");
  await policyDialog.waitFor({ state: "visible", timeout: 5000 });

  const toleranceInput = policyDialog.locator("#default-tolerance");
  const feeInput = policyDialog.locator("#late-fee-hourly");
  const feeSwitch = policyDialog.locator("#late-fee-enabled");
  const originalTolerance = "10";
  const originalEnabled = false;
  const originalFee = "0";

  await toleranceInput.fill("12");
  if (!(await feeSwitch.isChecked())) await feeSwitch.click();
  await feeInput.fill("5000");
  await policyDialog.getByRole("button", { name: "Simpan Aturan", exact: true }).click();
  await policyDialog.waitFor({ state: "hidden", timeout: 10000 });

  await page.getByText("Aturan penyewaan tersimpan.", { exact: true }).waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await page.getByRole("button", { name: "Ubah", exact: true }).click();
  await policyDialog.waitFor({ state: "visible", timeout: 5000 });
  if ((await toleranceInput.inputValue()) !== "12" || !(await feeSwitch.isChecked()) || (await feeInput.inputValue()) !== "5000") {
    throw new Error("Perubahan batas toleransi + denda tidak kembali terbaca setelah penyimpanan.");
  }

  await toleranceInput.fill(originalTolerance);
  await feeInput.fill(originalFee);
  if ((await feeSwitch.isChecked()) !== originalEnabled) await feeSwitch.click();
  await policyDialog.getByRole("button", { name: "Simpan Aturan", exact: true }).click();
  await policyDialog.waitFor({ state: "hidden", timeout: 10000 });

  const policyError = page.getByText(/Aturan penyewaan gagal disimpan/i);
  if (await policyError.count()) {
    throw new Error("Dialog aturan penyewaan masih melaporkan gagal disimpan.");
  }

  await nextProductButton.click();

  await page.waitForTimeout(500);
  const stepState = await page.locator('[aria-current="step"]').allInnerTexts();
  if (!stepState.some((text) => text.includes("Barang"))) {
    throw new Error(`Step setelah klik tidak berpindah ke Barang. currentStep=${JSON.stringify(stepState)}`);
  }

  const productCards = page.getByRole("button").filter({ hasText: /(?:\d+ siap|Tidak siap)/i });
  await page.waitForTimeout(1000);
  if (!(await productCards.count())) {
    const bodyText = await page.locator("body").innerText();
    throw new Error(`Tidak ada pilihan barang/stok di step 3. Body=${bodyText.slice(0, 5000)}`);
  }

  const availableProductCards = productCards.filter({ hasText: /[1-9]\d* siap/ });
  if (!(await availableProductCards.count())) {
    return { state: "BLOCKED_FIXTURE", reason: "Tidak ada barang aktif dengan unit siap disewakan pada fixture saat ini." };
  }

  const selectedProductCard = availableProductCards.first();
  await selectedProductCard.waitFor({ state: "visible", timeout: 15000 });
  const selectedProductCardText = await selectedProductCard.innerText();
  await selectedProductCard.click();
  await capture("walk-in-product-cards");

  const quantityInput = page.getByRole("spinbutton", { name: "Jumlah unit" });
  await quantityInput.waitFor({ state: "visible", timeout: 5000 });

  const stockMatch = selectedProductCardText.match(/(\d+) siap/);
  if (!stockMatch) throw new Error("Kartu barang tidak menampilkan jumlah unit siap.");
  const available = Number(stockMatch[1]);

  await quantityInput.fill(String(available + 1));
  await page.getByText(/Stok siap .* sementara diminta/i).waitFor({ state: "visible", timeout: 5000 });

  const addItemButton = page.getByRole("button", { name: "Tambahkan", exact: true });
  if (!(await addItemButton.isDisabled())) {
    throw new Error("Guard stok gagal: Tambahkan tetap aktif saat jumlah melebihi stok.");
  }
  await capture("walk-in-stock-guard");

  await quantityInput.fill("1");
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((element) => element.textContent?.trim() === "Tambahkan");
    return Boolean(button && button instanceof HTMLButtonElement && !button.disabled);
  }, { timeout: 15000 });
  await addItemButton.click();

  await page.getByText("Isi Penyewaan", { exact: true }).waitFor({ state: "visible", timeout: 5000 });

  await page.getByRole("button", { name: "Paket", exact: true }).click();
  const packageCards = page.getByRole("button").filter({ hasText: /(?:\d+ siap|Belum siap)/i });
  await page.waitForTimeout(500);
  const availablePackageCards = packageCards.filter({ hasText: /[1-9]\d* siap/ });
  if (!(await availablePackageCards.count())) {
    return {
      state: "BLOCKED_FIXTURE",
      reason: "Tidak ada paket dengan kapasitas siap pada fixture saat ini; barang satuan sudah berhasil ditambahkan.",
    };
  }

  const selectedPackageCard = availablePackageCards.first();
  await selectedPackageCard.click();
  const packageQuantity = page.getByRole("spinbutton", { name: "Jumlah paket" });
  await packageQuantity.waitFor({ state: "visible", timeout: 5000 });
  await packageQuantity.fill("1");

  const addPackageButton = page.getByRole("button", { name: "Tambahkan paket", exact: true });
  if (await addPackageButton.isDisabled()) {
    throw new Error("Paket terlihat siap tetapi tombol Tambahkan paket tetap disabled.");
  }
  await addPackageButton.click();

  await page.getByText("2 line", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
  await capture("walk-in-mixed-lines");
  return { state: "VERIFIED", interaction: ["open-walk-in", "select-renter", "fill-period", "select-product-card", "verify-stock", "add-item-line", "select-package-card", "add-package-line", "verify-mixed-lines"] };


}
