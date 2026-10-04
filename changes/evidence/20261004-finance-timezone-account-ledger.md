# Finance — Timezone Correction + Account Ledger UI

Date: 2026-10-04
Target: Finance payment timestamp correctness + Akun Uang / per-account movement tracking.

## Live source facts
- Rental RNT-2026-030: total Rp30.000, IDR, payment count 1 recorded.
- Payment #6: DP, QRIS Manual, Rp15.000, account Akasha Qris.
- Transaction #25: rental_payment, income, Rp15.000, source rental RNT-2026-030.
- Account movement: Akasha Qris, masuk, Rp15.000, recorded.
- Reconstructed Akasha Qris balance: Rp15.000.

## Timestamp anomaly and correction
- Original stored payment/transaction/movement timestamp was 2026-10-04 09:34:00+00.
- Tenant timezone is Asia/Jakarta; operator-entered wall time was 09:34 WIB.
- Root cause: datetime-local wall time was passed as if UTC.
- Trusted correction command changed all three synchronized timestamps to 2026-10-04 02:34:00+00.
- Amount, source, account, status, payment number and transaction number were not changed.
- Audit entry `correct_payment_timestamp` records old/new values and reason.

## New UI
- FinanceShell now exposes persistent Finance sub-navigation: Ringkasan, Pembayaran, Pengeluaran, Transaksi, Akun Uang.
- `/keuangan/akun` shows account cards with status, opening balance, incoming, outgoing and reconstructed balance.
- `/keuangan/akun/:id` shows per-account movement timeline with direction, amount, source, payment/rental/expense context and links to financial detail pages.
- Existing rental payment entry remains contextual and finance-owned.
- Payment form now defaults to tenant-local time and converts that wall time to UTC before RPC submission.

## Verification
- `keuangan.timezone.test.ts`: 2/2 PASS.
- Finance targeted regression: `keuangan.service.test.ts` 4/4; `keuangan.test.tsx` 8/8; `penyewaan.test.tsx` 3/3.
- TypeScript: PASS.
- ESLint on changed files: PASS.
- `git diff --check`: PASS in the successful gate run.
- Browser visual verification 390x844: VERIFIED, account tab → account list → Akasha Qris → detail mutation timeline, console/page/HTTP/request failures 0.
- Browser visual verification 1280x800: VERIFIED, same flow, console/page/HTTP/request failures 0.
- Production deployment/promotion: NOT PERFORMED.

## Notes
- Old inactive QA accounts remain visible in the account list as Nonaktif so historical account facts are not hidden.
- No automatic account creation was introduced.
- No accounting-suite semantics were added; this UI is account/movement traceability over the existing finance model.