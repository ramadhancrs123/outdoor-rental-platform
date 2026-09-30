const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export default async function pemeriksaanScenario({ page, baseURL, capture }) {
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#152a21";
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = "#dfeee6";
      ctx.font = "bold 42px sans-serif";
      ctx.fillText("AlpineRent · Kondisi Unit", 60, 90);
      ctx.font = "28px sans-serif";
      ctx.fillText("TD4P-001 · Tenda Dome · Eiger 4P", 60, 145);
    }
    const stream = canvas.captureStream(24);
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });
    }
    navigator.mediaDevices.getUserMedia = async () => stream;
  });

  let started = false;
  let attached = false;
  let completed = false;

  const unit = {
    unit_barang_id: "unit-qa-001",
    usaha_id: "usaha-qa",
    kode_unit: "TD4P-001",
    status: "inspection_pending",
    barang_id: "barang-qa",
    varian_barang_id: "variant-qa",
    updated_at: "2026-09-28T05:00:00.000Z",
  };
  const detail = {
    detail_pengembalian_id: "detail-qa-001",
    usaha_id: "usaha-qa",
    pengembalian_id: "return-qa-001",
    unit_barang_id: "unit-qa-001",
    diterima_at: "2026-09-28T04:21:00.000Z",
    status_pemeriksaan: "in_progress",
    catatan: null,
    updated_at: "2026-09-28T05:00:00.000Z",
  };

  const inspection = () => completed
    ? [{
        pemeriksaan_id: "inspection-qa-001",
        usaha_id: "usaha-qa",
        detail_pengembalian_id: "detail-qa-001",
        unit_barang_id: "unit-qa-001",
        diperiksa_at: "2026-09-28T05:22:00.000Z",
        diperiksa_by_admin_id: "admin-qa",
        hasil: "issue_found",
        kelengkapan_status: "incomplete",
        keputusan_operasional: "maintenance_required",
        catatan: "Resleting sisi kiri rusak",
        created_at: "2026-09-28T05:20:00.000Z",
        updated_at: "2026-09-28T05:22:00.000Z",
      }]
    : started
      ? [{
          pemeriksaan_id: "inspection-qa-001",
          usaha_id: "usaha-qa",
          detail_pengembalian_id: "detail-qa-001",
          unit_barang_id: "unit-qa-001",
          diperiksa_at: "2026-09-28T05:20:00.000Z",
          diperiksa_by_admin_id: "admin-qa",
          hasil: "pending",
          kelengkapan_status: "unknown",
          keputusan_operasional: "readiness_review",
          catatan: null,
          created_at: "2026-09-28T05:20:00.000Z",
          updated_at: "2026-09-28T05:20:00.000Z",
        }]
      : [];

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const table = new URL(request.url()).pathname.split("/").pop();
    const object = request.headers()["accept"]?.includes("vnd.pgrst.object");
    const common = {
      akun_admin: [{ akun_admin_id: "admin-qa" }],
      keanggotaan_usaha: [{ usaha_id: "usaha-qa" }],
      usaha: [{ usaha_id: "usaha-qa", nama: "Alpine Outdoor", status: "active", timezone: "Asia/Jakarta" }],
      unit_barang: [unit],
      detail_pengembalian: [detail],
      pengembalian: [{ pengembalian_id: "return-qa-001", usaha_id: "usaha-qa", penyewaan_id: "rental-qa-001", nomor_pengembalian: "RET-2026-001", status: "received" }],
      penyewaan: [{ penyewaan_id: "rental-qa-001", penyewa_id: "renter-qa-001" }],
      penyewa: [{ penyewa_id: "renter-qa-001", nama_lengkap: "Ahmad Fauzi", nomor_telepon: "082233445566" }],
      barang: [{ barang_id: "barang-qa", nama: "Tenda Dome" }],
      varian_barang: [{ varian_barang_id: "variant-qa", nama: "Eiger 4P" }],
      pemeriksaan: inspection(),
      temuan_pemeriksaan: completed
        ? [{
            temuan_pemeriksaan_id: "finding-qa-001",
            usaha_id: "usaha-qa",
            pemeriksaan_id: "inspection-qa-001",
            jenis_temuan: "damage",
            deskripsi: "Resleting sisi kiri rusak",
            tingkat: "Sedang",
            status_tindak_lanjut: "open",
            nominal_potensi_biaya: 150000,
            currency_code: "IDR",
            created_at: "2026-09-28T05:21:00.000Z",
            updated_at: "2026-09-28T05:21:00.000Z",
          }]
        : [],
      bukti_foto_kondisi: attached
        ? [{
            bukti_foto_kondisi_id: "evidence-qa-001",
            usaha_id: "usaha-qa",
            pemeriksaan_id: "inspection-qa-001",
            unit_barang_id: "unit-qa-001",
            jenis_foto: "overview",
            storage_bucket: "rental-private-condition",
            storage_path: "usaha-qa/inspection-qa-001/evidence-qa-001/condition-qa.jpg",
            captured_at: "2026-09-28T05:21:30.000Z",
            captured_by_admin_id: "admin-qa",
            catatan: null,
            created_at: "2026-09-28T05:21:30.000Z",
          }]
        : [],
    };
    let body = common[table] ?? [];
    if (table === "unit_barang" && new URL(request.url()).searchParams.get("status") !== "eq.inspection_pending") {
      body = [unit];
    }
    if (table === "pemeriksaan" && !started && !completed) body = [];
    if (object) body = Array.isArray(body) ? body[0] ?? null : body;
    return json(route, body);
  });

  await page.route("**/rpc/command_start_inspection", async (route) => {
    started = true;
    return json(route, {
      pemeriksaan_id: "inspection-qa-001",
      reused_draft: false,
      hasil: "pending",
      detail_pengembalian_id: "detail-qa-001",
    });
  });

  await page.route("**/rpc/command_complete_inspection", async (route) => {
    completed = true;
    return json(route, {
      pemeriksaan_id: "inspection-qa-001",
      keputusan_operasional: "maintenance_required",
      finding_count: 1,
    });
  });

  await page.route("**/rpc/command_attach_inspection_evidence", async (route) => {
    attached = true;
    return json(route, {
      bukti_foto_kondisi_id: "evidence-qa-001",
      pemeriksaan_id: "inspection-qa-001",
      storage_bucket: "rental-private-condition",
      storage_path: "usaha-qa/inspection-qa-001/evidence-qa-001/condition-qa.jpg",
    });
  });

  await page.route("**/rpc/command_reconcile_inspection_mutation", async (route) => {
    return json(route, { state: "not_found", response: null });
  });

  await page.route("**/storage/v1/object/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.includes("/sign/")) {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "image/png",
          body: Buffer.from(PNG_1X1, "base64"),
        });
      }
      return json(route, { signedURL: "/object/sign/rental-private-condition/evidence-qa-001/condition-qa.jpg?token=mock" });
    }
    return json(route, {});
  });

  await page.goto(baseURL + "/pemeriksaan", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
  await capture("pemeriksaan-queue");

  const desktopRow = page.locator("tbody tr").filter({ hasText: /TD4P-001/i }).first();
  if (await desktopRow.count() && await desktopRow.isVisible()) {
    await desktopRow.getByRole("link").click();
  } else {
    await page.getByRole("link").filter({ hasText: /TD4P-001/i }).first().click();
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText("Konteks Pemeriksaan", { exact: true }).waitFor({ state: "visible" });
  await capture("pemeriksaan-context");

  const clickSection = async (name) => {
    const tab = page.locator('[role="tab"]').filter({ hasText: name }).first();
    if (await tab.count() && await tab.isVisible()) {
      await tab.click();
      return;
    }
    const button = name === "Temuan"
      ? page.getByRole("button", { name: /^Temuan(?: \(\d+\))?$/i }).first()
      : page.getByRole("button", { name, exact: true }).first();
    await button.click();
  };

  const startButton = page.getByRole("button", { name: /^Mulai Pemeriksaan$/i }).first();
  await startButton.focus();
  await page.keyboard.press("Enter");
  await clickSection("Hasil & Keputusan");
  await capture("pemeriksaan-result");

  await page.getByRole("button", { name: /Ada Temuan/i }).first().click();
  await page.getByRole("button", { name: "Tidak Lengkap" }).click();
  await page.getByRole("button", { name: /Maintenance Required/i }).click();

  if (await page.getByText("Hasil & Keputusan", { exact: true }).count() === 0) {
    throw new Error("Workflow Hasil & Keputusan tidak tersedia.");
  }
  await clickSection("Temuan");
  const addFindingButton = page.getByRole("button", { name: /Tambah Temuan/i }).first();
  await addFindingButton.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Jenis").selectOption("damage");
  await page.getByLabel("Tingkat").fill("Sedang");
  await page.getByLabel("Deskripsi").fill("Resleting sisi kiri rusak");
  await page.getByLabel("Status Tindak Lanjut").fill("open");
  await page.getByLabel("Potensi Biaya").fill("150000");
  await capture("pemeriksaan-finding");

  await clickSection("Bukti Foto");
  await page.getByRole("button", { name: "Ambil Foto" }).click();
  const cameraDialog = page.getByRole("dialog", { name: "Bukti Foto Kondisi" });
  await cameraDialog.waitFor({ state: "visible" });
  const cameraFocusContained = await cameraDialog.evaluate((element) => element.contains(document.activeElement));
  if (!cameraFocusContained) throw new Error("Focus tidak masuk ke dialog bukti foto.");
  await capture("pemeriksaan-camera");

  const imageFile = page.locator('input[type="file"]').last();
  await imageFile.setInputFiles({
    name: "condition-qa.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("inspection-ui-qa-image"),
  });
  await page.waitForTimeout(400);
  await cameraDialog.press("Escape").catch(() => {});
  await clickSection("Review & Simpan");
  await page.getByRole("button", { name: /Simpan Pemeriksaan/i }).waitFor({ state: "visible" });
  await capture("pemeriksaan-review");

  await page.getByRole("button", { name: /Simpan Pemeriksaan/i }).click();
  await page.getByRole("heading", { name: "Pemeriksaan Berhasil Disimpan" }).waitFor({ state: "visible", timeout: 10000 });
  await capture("pemeriksaan-success");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("Pemeriksaan memiliki horizontal overflow.");

  return {
    state: "VERIFIED",
    interactions: [
      "queue",
      "context",
      "start-inspection",
      "result-completeness-decision",
      "finding-form",
      "camera-evidence",
      "review",
      "complete-success",
      "no-horizontal-overflow",
    ],
  };
}
