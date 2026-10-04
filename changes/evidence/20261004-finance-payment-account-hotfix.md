# Finance Payment 400 Hotfix — 2026-10-04

## Target
Rental Detail → Keuangan → Catat Pembayaran.

## Root cause VERIFIED
Live public.command_record_payment(...) intentionally fails closed with ACCOUNT_REQUIRED: pencatatan pembayaran baru wajib melalui akun keuangan.

The trusted account-aware command is public.command_record_payment_with_account(...) and requires p_akun_keuangan_id.

The active tenant currently has zero active IDR finance accounts. Three existing finance accounts are present but all are inactive.

The frontend had been calling the legacy fail-closed command and treated the resulting 400 as an unknown outcome.

## Implementation
- Rental Detail payment entry remains source-linked to the rental.
- Payment form now loads active IDR finance accounts.
- Payment form requires/auto-selects the account when exactly one is available.
- No active account produces an actionable setup state instead of an unknown transaction state.
- Payment mutation now calls command_record_payment_with_account.
- Payment reconciliation now uses reconcile_finance_command with command name record_payment_with_account.
- Live reconciliation allowlist was hardened to include record_payment_with_account.
- Finance home now exposes account setup when the tenant has no active account.

## Live verification
- RNT-2026-030 exists; total IDR 30,000; payment count before/after verification: 0.
- Active finance account count: 0.
- No payment was created by the failed attempts.
- 390×844 browser verification:
  - Rental Detail → Catat Pembayaran route: VERIFIED.
  - Payment route retains sourceType=rental, sourceId, sourceNumber: VERIFIED.
  - Legacy unknown-outcome screen is not shown for the no-account validation state: VERIFIED.
  - No active-account setup state is visible and actionable: VERIFIED.
  - Finance home account setup state: VERIFIED.
  - console errors: 0
  - page errors: 0
  - HTTP errors: 0
  - request failures: 0

## Code gate
Targeted tests: 8/8 PASS.
TypeScript: PASS.
ESLint on changed files: PASS.
git diff --check: PASS.

## Operational note
No finance account was auto-created during this hotfix. Creating an active Kas/Bank/E-Wallet account is a business configuration mutation and is left as an explicit admin action.

## Next action
Create one active IDR finance account in Keuangan, then perform one explicit payment test from the Rental Detail flow.