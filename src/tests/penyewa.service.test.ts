import { describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
    storage: {
      from: vi.fn(),
    },
  },
}));

import {
  createRenter,
  reconcileRenterCreation,
  reconcileRenterMutation,
  RenterStaleDataError,
  RenterUnknownOutcomeError,
  updateRenterProfile,
  verifyRenterIdentityEvidence,
} from "@/features/penyewa/service";

describe("Penyewa trusted mutation service", () => {
  test("create renter preserves tenant and idempotency contract", async () => {
    rpcMock.mockResolvedValue({
      data: {
        penyewa_id: "renter-1",
        usaha_id: "usaha-1",
        nama_lengkap: "Ahmad Fauzi",
        nomor_telepon: "08123456789",
        status: "active",
      },
      error: null,
    });

    await expect(createRenter("usaha-1", {
      nama_lengkap: "Ahmad Fauzi",
      nomor_telepon: "08123456789",
      alamat: "Garut",
    }, {
      idempotencyKey: "renter-create-test",
      requestId: "request-renter-test",
    })).resolves.toMatchObject({
      penyewa_id: "renter-1",
      status: "active",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_renter", {
      p_usaha_id: "usaha-1",
      p_nama_lengkap: "Ahmad Fauzi",
      p_nomor_telepon: "08123456789",
      p_alamat: "Garut",
      p_catatan_internal: null,
      p_idempotency_key: "renter-create-test",
      p_request_id: "request-renter-test",
    });
  });

  test("renter creation reconciliation exposes command state", async () => {
    rpcMock.mockResolvedValue({
      data: {
        state: "committed",
        response: {
          penyewa_id: "renter-1",
          usaha_id: "usaha-1",
          nama_lengkap: "Ahmad Fauzi",
          nomor_telepon: "08123456789",
          status: "active",
        },
      },
      error: null,
    });

    await expect(reconcileRenterCreation("usaha-1", "renter-create-test")).resolves.toEqual({
      state: "committed",
      response: {
        penyewa_id: "renter-1",
        usaha_id: "usaha-1",
        nama_lengkap: "Ahmad Fauzi",
        nomor_telepon: "08123456789",
        status: "active",
      },
    });

    expect(rpcMock).toHaveBeenCalledWith("command_reconcile_renter_creation", {
      p_usaha_id: "usaha-1",
      p_idempotency_key: "renter-create-test",
    });
  });
});


test("create renter reconciles a committed result after an RPC error", async () => {
  rpcMock
    .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
    .mockResolvedValueOnce({
      data: {
        state: "committed",
        response: {
          penyewa_id: "renter-2",
          usaha_id: "usaha-1",
          nama_lengkap: "Siti Aminah",
          nomor_telepon: "081298765432",
          status: "active",
        },
      },
      error: null,
    });

  await expect(createRenter("usaha-1", {
    nama_lengkap: "Siti Aminah",
    nomor_telepon: "081298765432",
  }, {
    idempotencyKey: "renter-create-reconcile-test",
    requestId: "request-renter-reconcile-test",
  })).resolves.toMatchObject({
    penyewa_id: "renter-2",
    status: "active",
  });

  expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_renter_creation", {
    p_usaha_id: "usaha-1",
    p_idempotency_key: "renter-create-reconcile-test",
  });
});

test("create renter surfaces UNKNOWN_OUTCOME instead of blind retry", async () => {
  rpcMock
    .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
    .mockResolvedValueOnce({
      data: { state: "unknown", response: null },
      error: null,
    });

  await expect(createRenter("usaha-1", {
    nama_lengkap: "Budi Santoso",
    nomor_telepon: "081211111111",
  }, {
    idempotencyKey: "renter-create-unknown-test",
    requestId: "request-renter-unknown-test",
  })).rejects.toBeInstanceOf(RenterUnknownOutcomeError);

  expect(rpcMock).toHaveBeenCalledTimes(2);
  expect(rpcMock).not.toHaveBeenCalledWith("command_create_renter", expect.objectContaining({
    p_idempotency_key: "renter-create-unknown-test-2",
  }));
});


test("update renter profile calls the trusted command with stale guard", async () => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({
    data: {
      penyewa_id: "renter-1",
      usaha_id: "usaha-1",
      nama_lengkap: "Ahmad Fauzi",
      nomor_telepon: "08123456789",
      alamat: "Garut",
      catatan_internal: "Catatan baru",
      status: "active",
      updated_at: "2026-09-29T05:00:00Z",
    },
    error: null,
  });

  await expect(updateRenterProfile("usaha-1", {
    penyewa_id: "renter-1",
    nama_lengkap: "Ahmad Fauzi",
    nomor_telepon: "08123456789",
    alamat: "Garut",
    catatan_internal: "Catatan baru",
    expected_updated_at: "2026-09-29T04:00:00Z",
  }, {
    idempotencyKey: "renter-update-test",
    requestId: "request-renter-update-test",
  })).resolves.toMatchObject({
    penyewa_id: "renter-1",
    updated_at: "2026-09-29T05:00:00Z",
  });

  expect(rpcMock).toHaveBeenCalledWith("command_update_renter_profile", expect.objectContaining({
    p_usaha_id: "usaha-1",
    p_penyewa_id: "renter-1",
    p_expected_updated_at: "2026-09-29T04:00:00Z",
    p_idempotency_key: "renter-update-test",
    p_request_id: "request-renter-update-test",
  }));
});

test("update renter profile surfaces stale-data conflict without reconciliation retry", async () => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({
    data: null,
    error: new Error("STALE_DATA: data penyewa berubah"),
  });

  await expect(updateRenterProfile("usaha-1", {
    penyewa_id: "renter-1",
    nama_lengkap: "Ahmad Fauzi",
    nomor_telepon: "08123456789",
    expected_updated_at: "2026-09-29T04:00:00Z",
  }, {
    idempotencyKey: "renter-update-stale-test",
    requestId: "request-renter-update-stale-test",
  })).rejects.toBeInstanceOf(RenterStaleDataError);

  expect(rpcMock).toHaveBeenCalledTimes(1);
});

test("identity verification reconciles after a transient RPC error", async () => {
  rpcMock.mockReset();
  rpcMock
    .mockResolvedValueOnce({
      data: null,
      error: new Error("network timeout"),
    })
    .mockResolvedValueOnce({
      data: {
        state: "committed",
        response: {
          buktiIdentitasId: "identity-1",
          penyewa_id: "renter-1",
          statusVerifikasi: "verified",
        },
        command_name: "verify_renter_identity_evidence",
      },
      error: null,
    });

  await expect(verifyRenterIdentityEvidence("usaha-1", {
    penyewa_id: "renter-1",
    bukti_identitas_id: "identity-1",
    status_verifikasi: "verified",
    expected_updated_at: "2026-09-29T04:00:00Z",
    catatan: "Cocok dengan dokumen yang diperiksa.",
  }, {
    idempotencyKey: "renter-verify-test",
    requestId: "request-renter-verify-test",
  })).resolves.toMatchObject({
    statusVerifikasi: "verified",
  });

  expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_renter_mutation", {
    p_usaha_id: "usaha-1",
    p_idempotency_key: "renter-verify-test",
  });
});

test("generic renter mutation reconciliation returns command state", async () => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({
    data: {
      state: "unknown",
      response: null,
      command_name: "add_renter_photo",
    },
    error: null,
  });

  await expect(reconcileRenterMutation("usaha-1", "renter-photo-test")).resolves.toEqual({
    state: "unknown",
    response: null,
    command_name: "add_renter_photo",
  });

  expect(rpcMock).toHaveBeenCalledWith("command_reconcile_renter_mutation", {
    p_usaha_id: "usaha-1",
    p_idempotency_key: "renter-photo-test",
  });
});
