# Evidence — Maintenance Finance Cash Out Multi-Account

Tanggal: 2026-10-04
Scope: Perawatan → Pengeluaran Finance → Cash Out Akun Uang

## Implemented
- Migration trusted command untuk multi-account settlement.
- Trusted completion command yang mengikat completion maintenance dengan expense + cash out.
- Account balance validation di database.
- Multi-account allocation UI pada Detail Perawatan.
- Timezone Usaha untuk waktu cash out.
- Unknown outcome reconciliation support.
- Finance expense link pada success state.

## Verification
- Supabase migration applied: finance_maintenance_cashout_multi_account_20261004113000 → success.
- TypeScript typecheck: PASS.
- Targeted ESLint: PASS.
- git diff --check: PASS.
- src/tests/perawatan.service.test.ts: 13/13 PASS.
- Live DB inspection confirmed Finance account movement and settlement structures already exist.
- Live DB currently has no in_progress maintenance record, so a true end-to-end cash-out mutation could not be executed without creating new operational test data.

## Next verification
1. single-account cash out;
2. insufficient single-account balance;
3. split across two accounts;
4. insufficient aggregate balance;
5. duplicate/retry/unknown outcome;
6. Finance account ledger reflects the resulting expense cash out.