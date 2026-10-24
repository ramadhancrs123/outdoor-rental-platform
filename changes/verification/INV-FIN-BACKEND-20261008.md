# Backend Verification Record — Investor + Finance

Date: 2026-10-08

## Remote migrations applied

- 20261008071840_investor_finance_backend_hardening
- 20261008072059_fix_investor_realtime_trigger_v2
- 20261008072114_fix_investor_operational_cash_acl
- 20261008072312_fix_investor_config_effective_window
- 20261008072503_fix_investor_reconciliation_readiness
- 20261008072800_fix_investor_currency_and_stakeholder_movement_guards
- 20261008072814_fix_investor_close_currency_guard

## Verified behaviors

- Open-period formula: Investor % × Operational Result. Positive QA case: income 100,000, expense 40,000, investor 10% → investor estimate 6,000.
- Negative-result floor: income 20,000, expense 70,000 → investor allocation 0.
- Operational balance is isolated from stakeholder accounts. Current demo operational balance verified at Rp90,000.
- Overdraft outbound movement rejected by DB trigger.
- Stakeholder-account outbound movement rejected by DB trigger.
- Period closing snapshot verified with reserve and distributable-cash fields.
- Idempotent period close verified by repeating the same close command in one QA transaction.
- Investor distribution and operator withdrawal verified; allocation remains partially distributed while remaining entitlement is preserved.
- Operational reserve guard verified: a distribution that would reduce operational cash below reserve is rejected.
- Realtime event journal verified: committed account change produced event sequence 53 with delivery timestamp and no error; trigger-to-send completion measured at 3.939 ms.
- Realtime replay verified: one event replayed successfully from checkpoint 51.
- Current authenticated Investor overview re-read successfully after the final database hardening migration: OPEN / DIRECT_FRESH / IDR, with the current demo tenant returning its existing 15% participation and Rp90,000 operational cash.
- Reconciliation correctly reports ATTENTION when investor/operator money accounts are not yet configured; this is expected for the current demo tenant.

## Verification limitation

Authenticated browser/E2E and a measured client-side p95/p99 latency SLO were not executed in this backend-only wave. The backend trigger-to-Realtime-send path is verified at the server boundary; client-side delivery/update latency remains a frontend/runtime verification item.
