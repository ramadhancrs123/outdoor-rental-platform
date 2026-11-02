export default async function cleanupDummyRentalAudited({ page, capture }) {
  let supabaseHeaders = null;
  page.on("request", (request) => {
    if (!request.url().includes("/rest/v1/")) return;
    const headers = request.headers();
    if (headers.apikey && headers.authorization) {
      supabaseHeaders = { apikey: headers.apikey, authorization: headers.authorization };
    }
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.readyState === "complete", { timeout: 10000 }).catch(() => {});
  if (!supabaseHeaders) throw new Error("Authenticated Supabase request headers were not observed; cleanup RPC was not called.");

  const result = await page.evaluate(async ({ headers }) => {
    const response = await fetch("https://nbirkybutpvtrqifaxlt.supabase.co/rest/v1/rpc/command_cleanup_dummy_rental", {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        p_usaha_id: "b0dc9553-1a62-4599-85d7-51a288d33567",
        p_idempotency_key: "cleanup-rnt-dummy-001-20261102-v1",
        p_request_id: "4a5f1f5d-16b3-4f71-94de-8f7a9e612f68",
      }),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, body };
  }, { headers: supabaseHeaders });

  if (!result.ok) {
    throw new Error("Audited dummy cleanup RPC failed (" + result.status + "): " + JSON.stringify(result.body));
  }
  if (result.body?.state !== "cancelled" || result.body?.payment_status !== "voided") {
    throw new Error("Cleanup RPC did not return the expected cancelled/voided state: " + JSON.stringify(result.body));
  }

  await capture("cleanup-dummy-rental-audited");
  return {
    state: "VERIFIED",
    rental: result.body.nomor_penyewaan,
    rentalStatus: result.body.state,
    paymentStatus: result.body.payment_status,
    assignmentCountCancelled: result.body.assignment_count_cancelled,
    qrStatus: result.body.qr_status,
    financeCorrection: result.body.finance_correction,
  };
}
