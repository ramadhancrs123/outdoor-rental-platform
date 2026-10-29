import { render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { FinanceCashout } from "@/components/keuangan/finance-cashout";
import type { FinanceAccount } from "@/features/keuangan";

function account(overrides: Partial<FinanceAccount> & Pick<FinanceAccount, "akun_keuangan_id" | "nama_akun" | "jenis_akun" | "saldo">): FinanceAccount {
  return {
    usaha_id: "usaha-1",
    kode_akun: overrides.akun_keuangan_id,
    mata_uang: "IDR",
    status: "active",
    fungsi_akun: "operasional",
    investor_id: null,
    pengelola_akun_admin_id: null,
    catatan: null,
    saldo_awal: 0,
    uang_masuk: 0,
    uang_keluar: 0,
    tanggal_saldo_awal: null,
    ...overrides,
  };
}

describe("FinanceCashout", () => {
  test("preselects operational cash first and then uses the next account for the remainder", async () => {
    const onAllocationsChange = vi.fn();

    render(
      <FinanceCashout
        accounts={[
          account({ akun_keuangan_id: "bank-operasional", nama_akun: "Bank Operasional", jenis_akun: "bank", saldo: 100000 }),
          account({ akun_keuangan_id: "kas-operasional", nama_akun: "Kas Operasional", jenis_akun: "kas", saldo: 50000 }),
        ]}
        amount={80000}
        allocations={{}}
        onAllocationsChange={onAllocationsChange}
        onProceed={vi.fn()}
        setupHref="/keuangan/akun"
      />,
    );

    await waitFor(() => {
      expect(onAllocationsChange).toHaveBeenCalledWith({
        "kas-operasional": "50000",
        "bank-operasional": "30000",
      });
    });
  });
});
