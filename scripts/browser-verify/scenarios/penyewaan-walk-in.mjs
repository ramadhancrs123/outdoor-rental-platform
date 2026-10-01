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
  await nextProductButton.click();
  await page.waitForTimeout(500);
  const stepState = await page.locator('[aria-current="step"]').allInnerTexts();
  if (!stepState.some((text) => text.includes("Barang"))) {
    throw new Error(`Step setelah klik tidak berpindah ke Barang. currentStep=${JSON.stringify(stepState)}`);
  }

  const categorySelect = page.locator("#walkin-category");
  await categorySelect.waitFor({ state: "visible", timeout: 5000 });

  const productCards = page.getByRole("button").filter({ hasText: /siap/ });
  await page.waitForTimeout(1500);
  if (!(await productCards.count())) {
    const bodyText = await page.locator("body").innerText();
    throw new Error(`Tidak ada kartu barang/stok di step 3. Body=${bodyText.slice(0, 5000)}`);
  }

  const availableProductCards = productCards.filter({ hasText: /[1-9]\d* siap/ });
  if (!(await availableProductCards.count())) {
    return { state: "BLOCKED_FIXTURE", reason: "Tidak ada barang aktif dengan unit Siap Disewakan pada fixture saat ini." };
  }

  const adidasCard = availableProductCards.filter({ hasText: /sepatu adidas/i }).first();
  const selectedProductCard = (await adidasCard.count()) ? adidasCard : availableProductCards.first();

  await selectedProductCard.waitFor({ state: "visible", timeout: 15000 });
  const selectedProductCardText = await selectedProductCard.innerText();
  const selectedProductIsAdidas = /sepatu adidas/i.test(selectedProductCardText);
  await selectedProductCard.click();
  await capture("walk-in-product-cards");

  const quantityInput = page.getByRole("spinbutton", { name: "Jumlah unit" });
  await quantityInput.waitFor({ state: "visible", timeout: 5000 });

  const productCardText = selectedProductCardText;
  const stockMatch = productCardText.match(/(\d+) siap/);
  if (!stockMatch) throw new Error("Kartu barang tidak menampilkan jumlah unit siap.");
  const available = Number(stockMatch[1]);

  await quantityInput.fill(String(available + 1));
  const reviewButton = page.getByRole("button", { name: /Lanjut ke review/i });
  await page.getByText(/Jumlah melebihi unit siap disewakan/i).waitFor({ state: "visible", timeout: 5000 });
  if (!(await reviewButton.isDisabled())) {
    throw new Error("Guard stok gagal: Lanjut ke review tetap aktif saat jumlah melebihi stok.");
  }
  await capture("walk-in-stock-guard");

  await quantityInput.fill("1");
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((element) => element.textContent?.includes("Lanjut ke review"));
    return Boolean(button && button instanceof HTMLButtonElement && !button.disabled);
  }, { timeout: 15000 });
  await reviewButton.click();

  await page.getByText(/Durasi ditagihkan/i).waitFor({ state: "visible", timeout: 5000 });
  const reviewText = await page.locator("body").innerText();
  if (!/4 hari/.test(reviewText)) {
    throw new Error("Durasi tarif tidak dihitung 4 hari untuk periode 4 x 24 jam.");
  }
  if (selectedProductIsAdidas && !/Rp\s*120\.000/.test(reviewText)) {
    throw new Error("Total sepatu Adidas tidak menjadi Rp120.000 untuk 4 hari pada tarif Rp30.000/hari.");
  }

  const draftButton = page.getByRole("button", { name: /Buat Draf Penyewaan/i });
  await draftButton.waitFor({ state: "visible", timeout: 10000 });
  await capture("walk-in-review-ready");

  let rpcErrorBody = "";
  const responseListener = async (response) => {
    if (response.url().includes("/rest/v1/rpc/command_create_direct_rental") && response.status() >= 400) {
      try {
        rpcErrorBody = await response.text();
      } catch {
        rpcErrorBody = "HTTP 404 tanpa response body yang dapat dibaca.";
      }
    }
  };
  page.on("response", responseListener);

  const initialPath = new URL(page.url()).pathname;
  await draftButton.click();
  try {
    await page.waitForURL((url) => url.pathname !== initialPath && /\/penyewaan\/[^/]+$/.test(url.pathname), { timeout: 15000 });
  } catch (error) {
    if (rpcErrorBody) throw new Error(`RPC command_create_direct_rental 404: ${rpcErrorBody}`);
    throw error;
  } finally {
    page.off("response", responseListener);
  }
  await capture("walk-in-draft-result");

  return {
    state: "VERIFIED",
    interaction: [
      "open-walk-in",
      "inspect-stepper",
      "open-inline-renter-dialog",
      "verify-renter-submit-disabled-when-empty",
      "select-renter",
      "fill-period",
      "select-product-card",
      "verify-stock-overflow-disables-review",
      "create-draft-rental",
    ],
  };
}
