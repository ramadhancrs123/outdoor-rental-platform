export default async function perawatanScenario({ page, baseURL, capture }) {
  if (page.url().includes("/login")) {
    await capture("auth-required");
    return { state: "BLOCKED_AUTH", reason: "Browser runner berada di halaman login setelah auth flow." };
  }

  let stage = "planned";
  let created = false;
  let completed = false;

  const unit = {
    unit_barang_id: "unit-mnt-001",
    usaha_id: "usaha-qa",
    kode_unit: "TD4P-001",
    status: "maintenance",
    barang_nama: "Tenda Dome",
    varian_nama: "Eiger 4P",
    updated_at: "2026-09-28T08:00:00.000Z",
  };

  const inspection = {
    pemeriksaan_id: "inspection-qa-001",
    unit_barang_id: "unit-mnt-001",
    hasil: "issue_found",
    kelengkapan_status: "complete",
    keputusan_operasional: "maintenance_required",
    diperiksa_at: "2026-09-28T07:30:00.000Z",
    unit: {
      unit_barang_id: unit.unit_barang_id,
      kode_unit: unit.kode_unit,
      status: unit.status,
      barang: { nama: unit.barang_nama },
      varian: { nama: unit.varian_nama },
    },
  };

  const finding = {
    temuan_pemeriksaan_id: "finding-qa-001",
    pemeriksaan_id: "inspection-qa-001",
    usaha_id: "usaha-qa",
    jenis_temuan: "damage",
    deskripsi: "Resleting sisi kiri rusak",
    tingkat: "Sedang",
    status_tindak_lanjut: "open",
    nominal_potensi_biaya: 150000,
    currency_code: "IDR",
  };

  const unitRecord = {
    unit_barang_id: unit.unit_barang_id,
    kode_unit: unit.kode_unit,
    status: unit.status,
    updated_at: unit.updated_at,
    barang: { barang_id: "barang-qa", nama: unit.barang_nama },
    varian: { varian_barang_id: "variant-qa", nama: unit.varian_nama },
  };

  const maintenance = () => ({
    perawatan_id: "maintenance-qa-001",
    usaha_id: "usaha-qa",
    unit_barang_id: "unit-mnt-001",
    pemeriksaan_id: "inspection-qa-001",
    jenis_perawatan: "repair",
    deskripsi_pekerjaan: "Ganti resleting sisi kiri dan uji buka-tutup.",
    status: stage,
    dimulai_at: stage === "in_progress" || stage === "completed" ? "2026-09-28T08:10:00.000Z" : null,
    selesai_at: stage === "completed" ? "2026-09-28T08:35:00.000Z" : null,
    biaya: stage === "completed" ? 150000 : null,
    currency_code: "IDR",
    pelaksana: "Nurdin Ramadhan",
    catatan: "Perbaikan komponen resleting.",
    created_at: "2026-09-28T08:00:00.000Z",
    updated_at: stage === "planned" ? "2026-09-28T08:00:00.000Z" : "2026-09-28T08:35:00.000Z",
  });

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const table = new URL(request.url()).pathname.split("/").pop();
    const object = request.headers().accept?.includes("vnd.pgrst.object");

    let body = [];
    if (table === "akun_admin") body = [{ akun_admin_id: "admin-qa" }];
    else if (table === "keanggotaan_usaha") body = [{ usaha_id: "usaha-qa", status: "active", revoked_at: null }];
    else if (table === "usaha") body = [{ usaha_id: "usaha-qa", nama: "Alpine Outdoor", status: "active" }];
    else if (table === "perawatan") body = [maintenance()];
    else if (table === "unit_barang") body = [unitRecord];
    else if (table === "pemeriksaan") body = [inspection];
    else if (table === "temuan_pemeriksaan") body = [finding];
    else if (table === "riwayat_unit") body = [
      { riwayat_unit_id: "history-1", jenis_kejadian: "maintenance_created", terjadi_at: "2026-09-28T08:00:00.000Z", status_sebelum: "inspection_pending", status_sesudah: "maintenance", catatan: "Maintenance dari hasil pemeriksaan.", sumber_type: "perawatan", sumber_id: "maintenance-qa-001" },
      { riwayat_unit_id: "history-2", jenis_kejadian: "inspection_completed", terjadi_at: "2026-09-28T07:30:00.000Z", status_sebelum: "inspection_pending", status_sesudah: "maintenance", catatan: "Ditemukan kerusakan.", sumber_type: "pemeriksaan", sumber_id: "inspection-qa-001" },
    ];

    if (table === "unit_barang") {
      const params = new URL(request.url()).searchParams;
      if (params.get("unit_barang_id")) {
        body = [{ ...unitRecord, status: "maintenance" }];
      } else {
        body = [{ ...unitRecord, status: "ready" }];
      }
    }

    if (object) body = body[0] ?? null;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.route("**/rpc/command_create_maintenance", async (route) => {
    created = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ perawatan_id: "maintenance-qa-001", status: "planned", pemeriksaan_id: route.request().postDataJSON()?.p_pemeriksaan_id ?? null }),
    });
  });

  await page.route("**/rpc/command_start_maintenance", async (route) => {
    stage = "in_progress";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ perawatan_id: "maintenance-qa-001", status: "in_progress" }) });
  });

  await page.route("**/rpc/command_complete_maintenance", async (route) => {
    stage = "completed";
    completed = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ perawatan_id: "maintenance-qa-001", status: "completed", biaya: 150000, verification_required: true }) });
  });

  await page.route("**/rpc/command_reconcile_maintenance_mutation", async (route) => {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "not_found", command_name: "create_maintenance", response: null }) });
  });

  await page.goto(`${baseURL}/perawatan`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
  await page.getByRole("heading", { name: "Perawatan", exact: true }).waitFor({ state: "visible" });
  await capture("perawatan-queue");

  await page.getByRole("link", { name: /Buat Perawatan/i }).click();
  await page.waitForURL(/\/perawatan\/create$/, { timeout: 10000 });
  await page.getByRole("heading", { name: "Buat Perawatan", exact: true }).waitFor({ state: "visible" });

  // Inspection-driven branch
  await page.getByRole("button", { name: /Dari Pemeriksaan/i }).click();
  await page.getByRole("combobox", { name: "Pilih pemeriksaan" }).selectOption("inspection-qa-001");
  await page.getByText("Resleting sisi kiri rusak", { exact: true }).waitFor({ state: "visible" });
  await capture("perawatan-create-source");

  await page.getByRole("button", { name: /Lanjut ke Detail/i }).click();
  await page.getByRole("textbox", { name: /Pelaksana/i }).fill("Nurdin Ramadhan");
  await page.getByRole("textbox", { name: /Deskripsi Pekerjaan/i }).fill("Ganti resleting sisi kiri dan uji buka-tutup.");
  await page.getByRole("spinbutton").fill("150000");
  await page.getByRole("textbox", { name: /Catatan/i }).fill("Ganti resleting sisi kiri (YKK), uji buka-tutup.");
  await page.getByRole("button", { name: /Lanjut ke Review/i }).click();
  await page.getByText("Review sebelum membuat", { exact: true }).waitFor({ state: "visible" });
  await capture("perawatan-create-review");

  await page.getByRole("button", { name: /Buat Perawatan/i }).click();
  await page.waitForURL(/\/perawatan\/maintenance-qa-001$/, { timeout: 10000 });
  await page.getByText("Perawatan Direncanakan", { exact: true }).waitFor({ state: "visible" });
  await capture("perawatan-planned");

  await page.getByRole("button", { name: /Mulai Perawatan/i }).click();
  await page.locator("header").getByText("Berjalan", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await capture("perawatan-in-progress");

  await page.getByRole("textbox", { name: "Pelaksana penyelesaian" }).fill("Nurdin Ramadhan");
  await page.getByRole("spinbutton", { name: "Biaya aktual" }).fill("150000");
  await page.getByRole("textbox", { name: /Catatan penyelesaian/i }).fill("Pekerjaan selesai dan diuji.");
  await page.getByRole("button", { name: /Selesaikan Perawatan/i }).click();
  await page.getByRole("heading", { name: "Perawatan Selesai", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await capture("perawatan-success");

  // Manual source branch: verify required reason and review flow without mutating again.
  await page.goto(`${baseURL}/perawatan`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("link", { name: /Buat Perawatan/i }).click();
  await page.waitForURL(/\/perawatan\/create$/, { timeout: 10000 });
  await page.getByRole("button", { name: /^Manual\b/i }).click();
  await page.getByRole("combobox", { name: "Pilih unit READY" }).selectOption("unit-mnt-001");
  const nextDetail = page.getByRole("button", { name: /Lanjut ke Detail/i });
  if (!(await nextDetail.isEnabled())) throw new Error("Manual source dengan unit READY tidak dapat masuk ke Detail.");
  await nextDetail.click();
  const manualReason = page.getByRole("textbox", { name: /Alasan maintenance manual/i });
  await manualReason.waitFor({ state: "visible" });
  const reviewButton = page.getByRole("button", { name: /Lanjut ke Review/i });
  if (await reviewButton.isEnabled()) throw new Error("Manual maintenance dapat lanjut tanpa reason.");
  await manualReason.fill("Pembersihan operasional rutin sebelum unit digunakan kembali.");
  await page.getByRole("textbox", { name: /Pelaksana/i }).fill("Nurdin Ramadhan");
  await page.getByRole("textbox", { name: /Deskripsi Pekerjaan/i }).fill("Pembersihan menyeluruh.");
  await reviewButton.click();
  await page.getByText("Alasan maintenance manual", { exact: true }).waitFor({ state: "visible" });
  await capture("perawatan-create-manual-review");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("Perawatan memiliki horizontal overflow.");

  return {
    state: "VERIFIED",
    created,
    completed,
    interaction: [
      "queue",
      "inspection-source",
      "detail",
      "review",
      "create-planned",
      "start-in-progress",
      "complete-success",
      "manual-source",
      "manual-reason-required",
      "manual-review",
      "no-horizontal-overflow",
    ],
  };
}
