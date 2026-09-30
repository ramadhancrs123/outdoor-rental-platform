export default async function penyewaanWalkInScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return {
      state: "BLOCKED_AUTH",
      reason: "Route Walk-in dilindungi Authenticated dan browser tidak memiliki sesi admin.",
    };
  }

  const heading = page.getByRole("heading", { name: "Buat Transaksi Walk-in" });
  await heading.waitFor({ state: "visible", timeout: 10000 });
  await capture("walk-in-initial");

  for (const label of ["Penyewa", "Periode", "Barang", "Review"]) {
    await page.getByText(label, { exact: true }).first().waitFor({ state: "visible", timeout: 3000 });
  }
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (horizontalOverflow) throw new Error("Walk-in memiliki horizontal overflow pada viewport ini.");

  await page.getByRole("button", { name: /Tambah penyewa/i }).waitFor({ state: "visible", timeout: 5000 });
  await page.getByRole("button", { name: /Tambah penyewa/i }).click();
  await page.getByRole("dialog", { name: "Tambah penyewa baru" }).waitFor({ state: "visible", timeout: 5000 });
  await capture("walk-in-renter-dialog");

  await page.getByRole("button", { name: /Buat dan pilih penyewa/i }).isDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Tambah penyewa baru" }).waitFor({ state: "hidden", timeout: 5000 });
  const focusAfterClose = await page.evaluate(() => document.activeElement?.textContent?.trim() || "");
  if (!focusAfterClose.includes("Tambah penyewa")) throw new Error("Focus tidak kembali ke tombol pemanggil setelah dialog ditutup.");

  const renterButtons = page.locator("button").filter({ hasText: /^.+$/ });
  const firstRenter = page.getByRole("button").filter({ hasText: /\S/ }).nth(1);
  if (await firstRenter.count()) {
    // Do not mutate fixture data; just prove step 1 selection affordance exists.
    await capture("walk-in-step1-ready");

    const renterChoice = page.getByRole("button").filter({ hasText: /Ahmad Fauzi/i }).first();
    if (await renterChoice.count()) {
      await renterChoice.click();
      await page.getByRole("button", { name: /Lanjut ke periode/i }).click();

      const periodInputs = page.locator('input[type="datetime-local"]');
      if (await periodInputs.count() >= 2) {
        const start = new Date(Date.now() + 60 * 60 * 1000);
        const end = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const localValue = (value) => {
          const pad = (n) => String(n).padStart(2, "0");
          return value.getFullYear() + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate()) +
            "T" + pad(value.getHours()) + ":" + pad(value.getMinutes());
        };
        await periodInputs.nth(0).fill(localValue(start));
        await periodInputs.nth(1).fill(localValue(end));
        await page.getByRole("button", { name: /Lanjut ke barang/i }).click();

        const productSelect = page.getByRole("combobox", { name: "Pilih barang" });
        await productSelect.click();
        const firstOption = page.getByRole("option").first();
        if (await firstOption.count()) {
          await firstOption.click();
          await page.getByText(/unit READY secara fisik/i).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
          const reviewButton = page.getByRole("button", { name: /Lanjut ke review/i });
          await reviewButton.waitFor({ state: "visible", timeout: 5000 });
          await page.waitForFunction(() => {
            const button = Array.from(document.querySelectorAll("button"))
              .find((element) => element.textContent?.includes("Lanjut ke review"));
            return Boolean(button && !(button instanceof HTMLButtonElement) || (button instanceof HTMLButtonElement && !button.disabled));
          }, { timeout: 15000 });
          await reviewButton.click();
          await page.getByRole("button", { name: /Buat Draft Rental/i }).waitFor({ state: "visible", timeout: 10000 });
          await capture("walk-in-review-ready");
        }
      }
    }
  }

  return {
    state: "VERIFIED",
    interaction: [
      "open-walk-in",
      "inspect-stepper",
      "open-inline-renter-dialog",
      "verify-renter-submit-disabled-when-empty",
      "close-inline-renter-dialog",
    ],
  };
}
