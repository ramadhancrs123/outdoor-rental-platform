const PLANNED_MAINTENANCE_ID = "ff359c76-4448-4ac3-9591-595c2b49af53";
const COMPLETED_MAINTENANCE_ID = "49eaba8d-fdba-4723-8cb8-a1933677d94b";

export default async function perawatanRegressionScenario({ page, capture }) {
  await page.addInitScript(() => {
    if (globalThis.crypto) {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    }
  });

  const unitResponses = [];
  const startCalls = [];
  const verifyCalls = [];

  page.on("response", async (response) => {
    if (!response.url().includes("/rest/v1/unit_barang")) return;

    const record = {
      status: response.status(),
      url: response.url(),
      rows: null,
    };

    if (response.status() === 200) {
      try {
        const json = await response.json();
        record.rows = Array.isArray(json) ? json : null;
      } catch {
        record.rows = null;
      }
    }

    unitResponses.push(record);
  });

  await page.route("**/rest/v1/rpc/command_start_maintenance", async (route) => {
    try {
      startCalls.push(JSON.parse(route.request().postData() || "{}"));
    } catch {
      startCalls.push({});
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        perawatan_id: PLANNED_MAINTENANCE_ID,
        unit_barang_id: "54d232f4-907b-4736-bb04-a937bcc350d2",
        status: "in_progress",
        dimulai_at: new Date().toISOString(),
      }),
    });
  });

  await page.route("**/rest/v1/rpc/command_verify_maintenance_readiness", async (route) => {
    try {
      verifyCalls.push(JSON.parse(route.request().postData() || "{}"));
    } catch {
      verifyCalls.push({});
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        perawatan_id: COMPLETED_MAINTENANCE_ID,
        unit_barang_id: "54d232f4-907b-4736-bb04-a937bcc350d2",
        verification_result: "passed",
        unit_status: "ready",
      }),
    });
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(700);

  const bodyText = await page.locator("body").innerText();
  const hasUnit = bodyText.includes("SPT-001");
  const hasUnavailableError = bodyText.includes("Data perawatan tidak tersedia.");
  const failedUnitResponses = unitResponses.filter((item) => item.status >= 300);
  const returnedRows = unitResponses.flatMap((item) => item.rows ?? []);
  const returnedTargetUnit = returnedRows.some((row) => row?.kode_unit === "SPT-001");

  if (!unitResponses.length) {
    throw new Error("Tidak ada request unit_barang selama reload halaman Perawatan.");
  }
  if (failedUnitResponses.length) {
    throw new Error("Request unit_barang masih mengembalikan status >= 300: " + JSON.stringify(unitResponses.map((item) => ({ status: item.status, url: item.url }))));
  }
  if (!hasUnit || !returnedTargetUnit) {
    throw new Error("SPT-001 tidak terbukti muncul dari response unit_barang atau UI Perawatan.");
  }
  if (hasUnavailableError) {
    throw new Error("UI masih menampilkan error data perawatan tidak tersedia.");
  }

  const origin = new URL(page.url()).origin;

  await page.goto(origin + "/perawatan/" + PLANNED_MAINTENANCE_ID, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  const plannedBodyBefore = await page.locator("body").innerText();

  if (!plannedBodyBefore.includes("SPT-001") || !plannedBodyBefore.includes("Mulai Perawatan")) {
    throw new Error("Detail maintenance planned SPT-001 tidak menampilkan aksi Mulai Perawatan.");
  }

  await page.getByRole("button", { name: "Mulai Perawatan" }).click();
  await page.waitForTimeout(500);

  const plannedBodyAfter = await page.locator("body").innerText();
  if (plannedBodyAfter.includes("crypto.randomUUID is not a function")) {
    throw new Error("Aksi Mulai Perawatan masih memanggil crypto.randomUUID.");
  }
  if (plannedBodyAfter.includes("Perawatan belum diperbarui")) {
    throw new Error("Aksi Mulai Perawatan masih menampilkan error pembaruan.");
  }
  if (startCalls.length !== 1 || !startCalls[0].p_idempotency_key) {
    throw new Error("RPC command_start_maintenance tidak menerima idempotency key dari client.");
  }

  await page.goto(origin + "/perawatan/" + COMPLETED_MAINTENANCE_ID, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  const completedBodyBefore = await page.locator("body").innerText();

  if (!completedBodyBefore.includes("SPT-001") || !completedBodyBefore.includes("Verifikasi Lulus")) {
    throw new Error("Detail maintenance completed SPT-001 tidak menampilkan aksi Verifikasi Lulus.");
  }

  await page.getByRole("button", { name: "Verifikasi Lulus" }).click();
  await page.waitForTimeout(500);

  const completedBodyAfter = await page.locator("body").innerText();
  if (completedBodyAfter.includes("crypto.randomUUID is not a function")) {
    throw new Error("Aksi Verifikasi Lulus masih memanggil crypto.randomUUID.");
  }
  if (completedBodyAfter.includes("Perawatan belum diperbarui")) {
    throw new Error("Aksi Verifikasi Lulus masih menampilkan error pembaruan.");
  }
  if (verifyCalls.length !== 1 || !verifyCalls[0].p_idempotency_key) {
    throw new Error("RPC command_verify_maintenance_readiness tidak menerima idempotency key dari client.");
  }

  await capture("perawatan-regression");

  return {
    state: "VERIFIED",
    unitRequests: unitResponses.length,
    failedUnitRequests: failedUnitResponses.length,
    returnedTargetUnit,
    plannedMaintenanceAction: "VERIFIED_WITH_RPC_MOCK",
    verificationAction: "VERIFIED_WITH_RPC_MOCK",
    startRpcCalls: startCalls.length,
    verificationRpcCalls: verifyCalls.length,
    cryptoRandomUUIDDisabled: true,
  };
}
