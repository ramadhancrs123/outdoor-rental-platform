export default async function investorConfigContractScenario({ page, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Konfigurasi membutuhkan sesi admin." };
  }

  await page.getByRole("heading", { name: "Konfigurasi Investor" }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByLabel("Persentase Bagi Hasil").waitFor({ state: "visible", timeout: 15000 });
  await page.getByLabel("Nilai Cadangan").waitFor({ state: "visible", timeout: 15000 });
  await page.getByLabel("Bulan Efektif").waitFor({ state: "visible", timeout: 15000 });
  await page.getByLabel("Tanggal Mulai Periode").waitFor({ state: "visible", timeout: 15000 });
  await page.getByLabel("Tanggal Akhir Periode").waitFor({ state: "visible", timeout: 15000 });

  const percentage = page.getByLabel("Persentase Bagi Hasil");
  const reserve = page.getByLabel("Nilai Cadangan");
  const month = page.getByLabel("Bulan Efektif");
  const start = page.getByLabel("Tanggal Mulai Periode");
  const end = page.getByLabel("Tanggal Akhir Periode");
  const save = page.getByRole("button", { name: "Simpan Perubahan" });

  const original = {
    percentage: await percentage.inputValue(),
    reserve: await reserve.inputValue(),
    month: await month.inputValue(),
    start: await start.inputValue(),
    end: await end.inputValue(),
    operator: await page.getByLabel("Pengelola Usaha").inputValue(),
  };
  if (!original.percentage || !original.reserve || !original.month || !original.start || !original.end || !original.operator) {
    throw new Error("Nilai konfigurasi efektif atau relasi Pengelola tidak terisi dari read model backend.");
  }
  const p = Number(original.percentage);
  const r = Number(original.reserve);
  const s = Number(original.start);
  const e = Number(original.end);
  if (!Number.isFinite(p) || p < 0 || p > 100 || !Number.isFinite(r) || r < 0 || s < 1 || s > 31 || e < s || e > 31) {
    throw new Error("Read model konfigurasi mengandung nilai di luar kontrak frontend.");
  }

  // Read/validation-only: restore original values before leaving and never click Save.
  await percentage.fill("");
  if (!(await save.isDisabled())) throw new Error("Save harus dinonaktifkan saat persentase kosong.");
  await percentage.fill(original.percentage);

  await reserve.fill("");
  if (!(await save.isDisabled())) throw new Error("Save harus dinonaktifkan saat cadangan kosong.");
  await reserve.fill(original.reserve);

  await start.fill("0");
  if (!(await save.isDisabled())) throw new Error("Save harus dinonaktifkan saat tanggal mulai di luar rentang.");
  await start.fill(original.start);

  await end.fill("0");
  if (!(await save.isDisabled())) throw new Error("Save harus dinonaktifkan saat tanggal akhir berada sebelum tanggal mulai atau di luar rentang.");
  await end.fill(original.end);

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (horizontalOverflow) throw new Error("Konfigurasi Investor menyebabkan overflow horizontal.");
  await capture("investor-config-contract");

  return {
    state: "VERIFIED",
    checks: [
      "investor-config-read-model-loaded",
      "percentage-and-reserve-loaded",
      "effective-month-and-configured-day-range-loaded",
      "blank-percentage-blocked",
      "blank-reserve-blocked",
      "invalid-start-day-blocked",
      "invalid-end-day-blocked",
      "original-values-restored-without-saving",
      "no-horizontal-overflow",
    ],
    configured: {
      effectiveMonth: original.month,
      startDay: s,
      endDay: e,
      percentage: p,
      reserve: r,
    },
    saveWasClicked: false,
    horizontalOverflow,
  };
}
