const UNIT_ID = "54d232f4-907b-4736-bb04-a937bcc350d2";
const COMPLETED_MAINTENANCE_ID = "ff359c76-4448-4ac3-9591-595c2b49af53";

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}

export default async function perawatanReadinessFlowScenario({ page, capture }) {
  const origin = new URL(page.url()).origin;

  await page.goto(origin + "/inventaris/" + UNIT_ID, { waitUntil: "domcontentloaded" });
  await settle(page);
  let body = await page.locator("body").innerText();

  if (!body.includes("SPT-001")) throw new Error("Detail Inventaris SPT-001 tidak terbuka.");

  const needsReadiness = body.includes("Verifikasi Kesiapan");
  const alreadyReady = body.includes("Siap Disewakan") && !needsReadiness;

  if (!needsReadiness && !alreadyReady) {
    throw new Error("Inventaris tidak berada pada state maintenance-awaiting-readiness maupun ready.");
  }

  await capture(needsReadiness ? "inventory-before-readiness" : "inventory-already-ready");

  if (needsReadiness) {
    await page.goto(origin + "/perawatan/" + COMPLETED_MAINTENANCE_ID, { waitUntil: "domcontentloaded" });
    await settle(page);
    body = await page.locator("body").innerText();

    if (!body.includes("SPT-001") || !body.includes("Verifikasi Lulus")) {
      throw new Error("Detail maintenance completed SPT-001 tidak menyediakan Verifikasi Lulus.");
    }
    if (body.includes("Mulai Perawatan")) {
      throw new Error("Maintenance completed masih menampilkan aksi Mulai Perawatan.");
    }

    await page.getByRole("button", { name: "Verifikasi Lulus", exact: true }).click();
    await page.waitForTimeout(700);

    body = await page.locator("body").innerText();
    if (body.includes("Verifikasi gagal diproses") || body.includes("Perawatan belum diperbarui")) {
      throw new Error("Verifikasi readiness menampilkan error setelah command.");
    }
    if (!body.includes("Verifikasi LULUS. Inventaris menetapkan unit Siap Disewakan.")) {
      throw new Error("Feedback Verifikasi LULUS tidak muncul.");
    }
    await capture("maintenance-readiness-passed");
  }

  await page.goto(origin + "/inventaris/" + UNIT_ID, { waitUntil: "domcontentloaded" });
  await settle(page);
  body = await page.locator("body").innerText();

  if (!body.includes("Siap Disewakan")) {
    throw new Error("Inventaris belum kembali ke Siap Disewakan setelah readiness path.");
  }
  if (body.includes("Buka Perawatan") || body.includes("Lanjutkan Perawatan") || body.includes("Verifikasi Kesiapan")) {
    throw new Error("Aksi maintenance masih muncul setelah unit menjadi ready.");
  }
  await capture("inventory-ready");

  await page.goto(origin + "/perawatan/" + COMPLETED_MAINTENANCE_ID, { waitUntil: "domcontentloaded" });
  await settle(page);
  body = await page.locator("body").innerText();

  if (!body.includes("Unit Siap Disewakan")) {
    const relevant = body.split("\n").filter((line) => /unit|verifikasi|ready|siap|maintenance/i.test(line)).slice(-60).join(" | ");
    console.log("MAINTENANCE_DETAIL_RELEVANT:", relevant);
    throw new Error("Detail maintenance completed belum mencerminkan unit yang sudah ready.");
  }
  if (body.includes("Verifikasi Lulus")) {
    throw new Error("Tombol Verifikasi Lulus masih ditampilkan setelah unit sudah ready.");
  }
  await capture("maintenance-detail-ready");

  await page.goto(origin + "/perawatan", { waitUntil: "domcontentloaded" });
  await settle(page);
  body = await page.locator("body").innerText();
  if (body.includes("SPT-001")) {
    throw new Error("Perawatan SPT-001 yang sudah ready masih muncul pada filter Perlu Tindakan.");
  }
  if (!body.includes("Perlu Tindakan")) {
    throw new Error("Filter default Perawatan belum berubah menjadi Perlu Tindakan.");
  }

  await page.goto(origin + "/perawatan/create", { waitUntil: "domcontentloaded" });
  await settle(page);
  body = await page.locator("body").innerText();
  if (body.includes("SPT-001")) {
    throw new Error("Inspection SPT-001 yang sudah memiliki maintenance masih ditawarkan sebagai kandidat maintenance baru.");
  }

  await page.getByRole("button", { name: /Pilih unit langsung/i }).click();
  await page.getByRole("button", { name: /SPT-001/i }).first().click();
  await page.getByRole("button", { name: /Lanjut ke Detail/i }).click();
  await settle(page);
  const executorInput = page.getByRole("textbox", { name: "Pelaksana" });
  if ((await executorInput.inputValue()).trim() === "") {
    throw new Error("Nama pelaksana tidak otomatis terisi dari admin aktif.");
  }
  await capture("maintenance-create-manual-prefilled");

  return {
    state: "VERIFIED",
    readinessPath: alreadyReady ? "ALREADY_READY" : "VERIFIED_NOW",
    inventoryReady: true,
    completedMaintenanceDetail: "VERIFIED",
    maintenanceQueueFiltering: "VERIFIED",
    createCandidateFiltering: "VERIFIED",
    manualMaintenanceExecutorPrefill: "VERIFIED",
  };
}
