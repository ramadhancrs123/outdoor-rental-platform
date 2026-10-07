export default async function penyewaanOperationalWorkspaceMock({ page, capture }) {
  const usahaId = "usaha-qa-001";
  const rentalId = "rental-qa-001";
  const renterId = "renter-qa-001";
  const detailId = "detail-qa-001";
  const now = "2026-10-05T04:00:00Z";

  const rental = {
    penyewaan_id: rentalId,
    usaha_id: usahaId,
    reservasi_id: null,
    penyewa_id: renterId,
    nomor_penyewaan: "RNT-2026-9001",
    jadwal_mulai: "2026-10-03T04:00:00Z",
    jadwal_kembali: "2026-10-05T04:00:00Z",
    tolerance_deadline: "2026-10-05T14:00:00Z",
    actual_pickup_at: "2026-10-03T04:05:00Z",
    actual_return_started_at: now,
    actual_return_completed_at: null,
    status: "return_in_progress",
    total_amount: 300000,
    currency_code: "IDR",
    catatan: "Browser verification fixture",
    created_at: "2026-10-03T03:00:00Z",
    updated_at: "2026-10-05T03:59:00Z",
  };

  const operationalWorkspace = {
    rental: {
      ...rental,
      renter: undefined,
    },
    renter: { penyewa_id: renterId, nama_lengkap: "Ahmad QA", nomor_telepon: "081200000001" },
    units: [
      {
        unit_barang_id: "unit-qa-001",
        kode_unit: "TND-001",
        barang_id: "barang-qa-001",
        barang_nama: "Tenda Dome 4P",
        varian_barang_id: null,
        unit_status: "ready",
        kondisi_ringkas: null,
        assignment: { penetapan_unit_id: "assign-qa-001", detail_penyewaan_id: detailId, komponen_penyewaan_id: null, status: "assigned" },
        return: { pengembalian_id: "ret-qa-001", detail_pengembalian_id: "ret-detail-qa-001", diterima_at: now, kondisi_awal: null, status_pemeriksaan: "completed", catatan: null },
        inspection: { pemeriksaan_id: "ins-qa-001", detail_pengembalian_id: "ret-detail-qa-001", hasil: "normal", kelengkapan_status: "complete", keputusan_operasional: "ready_review", diperiksa_at: now, catatan: null, finding_count: 0 },
        maintenance: null,
        readiness_state: "ready",
      },
      {
        unit_barang_id: "unit-qa-002",
        kode_unit: "TND-002",
        barang_id: "barang-qa-001",
        barang_nama: "Tenda Dome 4P",
        varian_barang_id: null,
        unit_status: "maintenance",
        kondisi_ringkas: null,
        assignment: { penetapan_unit_id: "assign-qa-002", detail_penyewaan_id: detailId, komponen_penyewaan_id: null, status: "assigned" },
        return: { pengembalian_id: "ret-qa-002", detail_pengembalian_id: "ret-detail-qa-002", diterima_at: now, kondisi_awal: null, status_pemeriksaan: "completed", catatan: "Resleting rusak." },
        inspection: { pemeriksaan_id: "ins-qa-002", detail_pengembalian_id: "ret-detail-qa-002", hasil: "issue_found", kelengkapan_status: "complete", keputusan_operasional: "maintenance_required", diperiksa_at: now, catatan: "Kerusakan resleting.", finding_count: 1 },
        maintenance: { perawatan_id: "maintenance-qa-002", pemeriksaan_id: "ins-qa-002", jenis_perawatan: "perbaikan", status: "planned" },
        readiness_state: "maintenance_required",
      },
    ],
    returnRecords: [],
  };

  const json = (body, status = 200) => route => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === "POST" && path.endsWith("/rpc/get_operational_return_workspace")) {
      return json(operationalWorkspace)(route);
    }
    if (method === "POST" && path.endsWith("/rpc/daftar_qr_penyewaan")) {
      return json([{ usaha_id: usahaId, penyewaan_id: rentalId, nomor_penyewaan: rental.nomor_penyewaan, token_qr: "qa-token", status: rental.status }])(route);
    }
    if (method === "POST" && path.endsWith("/rpc/list_rental_consequence_reviews")) {
      return json([])(route);
    }
    if (method !== "GET") {
      return json([])(route);
    }

    if (path.endsWith("/penyewaan")) return json([rental])(route);
    if (path.endsWith("/detail_penyewaan")) return json([{ detail_penyewaan_id: detailId, usaha_id: usahaId, penyewaan_id: rentalId, barang_id: "barang-qa-001", varian_barang_id: null, paket_sewa_id: null, jumlah: 2, unit_price: 150000, currency_code: "IDR", subtotal: 300000, catatan: null }])(route);
    if (path.endsWith("/penetapan_unit")) return json([
      { penetapan_unit_id: "assign-qa-001", usaha_id: usahaId, detail_penyewaan_id: detailId, komponen_penyewaan_id: null, unit_barang_id: "unit-qa-001", asal_pilihan_unit_id: null, status: "assigned", ditetapkan_at: now, dibatalkan_at: null, alasan_substitusi: null, ditetapkan_by_admin_id: "admin-qa-001", catatan: null },
      { penetapan_unit_id: "assign-qa-002", usaha_id: usahaId, detail_penyewaan_id: detailId, komponen_penyewaan_id: null, unit_barang_id: "unit-qa-002", asal_pilihan_unit_id: null, status: "assigned", ditetapkan_at: now, dibatalkan_at: null, alasan_substitusi: null, ditetapkan_by_admin_id: "admin-qa-001", catatan: null },
    ])(route);
    if (path.endsWith("/komponen_penyewaan")) return json([])(route);
    if (path.endsWith("/serah_terima")) return json([{ serah_terima_id: "handover-qa-001", usaha_id: usahaId, penyewaan_id: rentalId, serah_terima_at: "2026-10-03T04:05:00Z", actor_admin_id: "admin-qa-001", status: "completed", catatan: null }])(route);
    if (path.endsWith("/perpanjangan_sewa")) return json([])(route);
    if (path.endsWith("/riwayat_toleransi_penyewaan")) return json([])(route);
    if (path.endsWith("/penyewa")) return json([{ penyewa_id: renterId, usaha_id: usahaId, nama_lengkap: "Ahmad QA", nomor_telepon: "081200000001" }])(route);
    if (path.endsWith("/pengembalian")) return json([
      { pengembalian_id: "ret-qa-001", usaha_id: usahaId, penyewaan_id: rentalId, nomor_pengembalian: "RET-2026-9001", dimulai_at: now, selesai_at: null, status: "in_progress", diproses_by_admin_id: "admin-qa-001", catatan: null },
      { pengembalian_id: "ret-qa-002", usaha_id: usahaId, penyewaan_id: rentalId, nomor_pengembalian: "RET-2026-9002", dimulai_at: now, selesai_at: null, status: "in_progress", diproses_by_admin_id: "admin-qa-001", catatan: null },
    ])(route);
    if (path.endsWith("/detail_pengembalian")) return json([
      { detail_pengembalian_id: "ret-detail-qa-001", usaha_id: usahaId, pengembalian_id: "ret-qa-001", unit_barang_id: "unit-qa-001", diterima_at: now, kondisi_awal: null, status_pemeriksaan: "completed", catatan: null },
      { detail_pengembalian_id: "ret-detail-qa-002", usaha_id: usahaId, pengembalian_id: "ret-qa-002", unit_barang_id: "unit-qa-002", diterima_at: now, kondisi_awal: null, status_pemeriksaan: "completed", catatan: "Resleting rusak." },
    ])(route);
    if (path.endsWith("/pemeriksaan")) return json([
      { pemeriksaan_id: "ins-qa-001", detail_pengembalian_id: "ret-detail-qa-001", hasil: "normal", kelengkapan_status: "complete", keputusan_operasional: "ready_review", diperiksa_at: now },
      { pemeriksaan_id: "ins-qa-002", detail_pengembalian_id: "ret-detail-qa-002", hasil: "issue_found", kelengkapan_status: "complete", keputusan_operasional: "maintenance_required", diperiksa_at: now },
    ])(route);
    if (path.endsWith("/akun_admin")) return json([{ akun_admin_id: "admin-qa-001", nama_tampilan: "Admin QA" }])(route);
    if (path.endsWith("/keanggotaan_usaha")) return json([{ usaha_id: usahaId, status: "active", revoked_at: null }])(route);
    if (path.endsWith("/usaha")) return json([{ usaha_id: usahaId, nama: "Rental QA", alamat: "Tasikmalaya", nomor_telepon: "081200000000", email: "qa@example.test", timezone: "Asia/Jakarta", status: "active", default_tolerance_hours: 10, late_fee_enabled: true, late_fee_per_hour: 10000 }])(route);
    if (path.endsWith("/barang")) return json([{ barang_id: "barang-qa-001", nama: "Tenda Dome 4P", status: "active" }])(route);
    if (path.endsWith("/varian_barang")) return json([])(route);
    if (path.endsWith("/paket_sewa")) return json([])(route);
    if (path.endsWith("/unit_barang")) return json([
      { unit_barang_id: "unit-qa-001", usaha_id: usahaId, barang_id: "barang-qa-001", varian_barang_id: null, kode_unit: "TND-001", status: "ready" },
      { unit_barang_id: "unit-qa-002", usaha_id: usahaId, barang_id: "barang-qa-001", varian_barang_id: null, kode_unit: "TND-002", status: "maintenance" },
    ])(route);
    if (path.endsWith("/pembayaran")) return json([])(route);
    return json([])(route);
  });

  await page.goto(`${new URL(page.url()).origin}/penyewaan/${rentalId}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("rental-detail-root").waitFor({ state: "visible", timeout: 15000 });
  const operational = page.getByTestId("rental-operational-workspace");
  await operational.waitFor({ state: "visible", timeout: 15000 });

  const viewport = page.viewportSize();
  const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  if (metrics.scrollWidth > metrics.clientWidth) throw new Error("Horizontal overflow pada operational rental workspace.");

  const checks = [
    operational.locator("p").filter({ hasText: /Pusat Operasional/i }).first(),
    operational.locator("h2").filter({ hasText: /Pengembalian → Kondisi → Ready/i }).first(),
    operational.getByText(/Siap Disewakan/i).first(),
    operational.getByText(/Masuk Perawatan/i).first(),
  ];
  for (const loc of checks) {
    if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) {
      const body = await page.locator("body").innerText();
      throw new Error("Elemen operational workspace tidak terlihat.\nBODY\n" + body.slice(0, 8000));
    }
  }

  if (!(await operational.getByText(/Unit normal tidak tertahan/).count())) throw new Error("Guardrail mixed readiness tidak terlihat.");
  await capture("rental-operational-workspace-mixed-ready-maintenance");
  return { state: "VERIFIED", viewport, overflow: false, mixedPerUnitReadiness: true, fixture: "browser-mock" };
}
