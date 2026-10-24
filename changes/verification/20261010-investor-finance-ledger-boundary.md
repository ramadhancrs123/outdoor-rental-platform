# Verification — Investor Finance Ledger Boundary

Date: 2026-10-10
Scope: Investor/Finance entitlement, external payout, internal account movement, history/read model, and principal resolution.

## Candidate and target

- Repository HEAD remains `515e0ddb5465789ec790452437d90f4dd4da45b6` on branch `production-demo-20261007`.
- Worktree remains dirty as it was before this continuation. No changes were staged or committed; no Vercel deployment was performed.
- Supabase target: `nbirkybutpvtrqifaxlt` (`outdoor-rental-platform`, `ap-southeast-1`, project status previously confirmed `ACTIVE_HEALTHY`).
- Migration `20261009185014_investor_finance_ledger_boundary`: file `supabase/migrations/20261009185014_investor_finance_ledger_boundary.sql`, SHA-256 `ad15949a8b310632d043a4f9d08d1f650a131bd60c12ae7a24fd4469520f63da`.
- Migration `20261010015838_investor_finance_read_principal_precedence`: file `supabase/migrations/20261010015838_investor_finance_read_principal_precedence.sql`, SHA-256 `73dc7cc7af4c5be65f9cccaf2cd9fc4fb60f3ba8a5ab7001f8e73dcc100dfa45`.
- Supabase migration history contains both versions: `20261009185014` and `20261010015838`.

## Implementation

- Added separate records/RPCs for external Investor/Pengelola payouts and Investor entitlement transfers.
- Physical account balances, rights allocations, external payouts, entitlement transfers, and historical internal cash segregation are presented as separate concepts.
- Rights transfer to Usaha or Pengelola does not itself move physical cash. When explicitly selected, a physical movement is recorded atomically and separately.
- Payouts and internal rights transfers do not affect Net Operational Result.
- Added the in-context Investor account history card with physical-account balances, remaining rights, paid/transferred amounts, and up to 25 recent events that indicate whether physical money moved.
- Added realtime invalidation for the stakeholder history query.
- Corrected backend read-principal precedence to match the app identity resolver: active business-scoped super-admin membership takes precedence over Investor identity for that same business; Investor read access is the fallback if no scoped admin membership exists. Business membership is still required for admin-level data.
- ADRs: `FIN-INV-ADR-004-entitlement-payout-cash-separation.md` and `FIN-INV-ADR-005-admin-first-investor-read-principal.md`.

## Database verification

- Both migrations applied successfully through Supabase migration execution; history verifies the recorded versions.
- Postflight confirmed the new payout/transfer tables, allocation columns, secured RPC access, RLS enabled, validated constraints, and no negative/overallocated allocation rows or orphan transfers.
- Under `SET LOCAL ROLE authenticated` with the dummy admin identity in explicit transactions, the read history returned `principal=admin`, two physical accounts and two allocations (one Investor, one Pengelola). The account read model returned `status=OK`, two holding accounts, one Investor allocation, and one Pengelola allocation.
- Authenticated-role rollback smoke tests invoked Investor payout, Pengelola payout, rights transfer with physical movement, and rights transfer without physical movement. All commands returned `recorded`; payout/transfer responses indicated `affects_operational_result=false`; the transfer-without-physical-movement response had null transaction/physical-transfer IDs and `physical_money_moved=false`.
- A post-rollback query verified zero payout rows and zero entitlement-transfer rows persisted, Investor and Pengelola distributed/transfer amounts remained zero, and the operational account balance remained `0.00`. No test finance rows were left in the dummy database.
- Legacy distribution/withdrawal RPCs remain present but EXECUTE is revoked for `authenticated` and `anon`. New public payout/history/transfer APIs are executable by `authenticated`, not `anon`. Direct table access remains restricted; advisor INFO findings for RLS-enabled tables without policies are consistent with the RPC-only access model.

## Code and UX verification

- `pnpm typecheck`: passed after the final realtime invalidation change.
- Targeted ESLint on all changed Investor UI/service/types/tests: passed with no warnings or errors.
- `pnpm exec vitest run src/tests/investor.contract.test.ts src/tests/investor.history.test.tsx`: 2 files passed, 11 tests passed.
- `pnpm exec vite build`: passed; Vite emitted existing bundle-size/dynamic-import warnings outside this scope.
- The full `investor-dashboard` browser scenario passed at mobile `390x844` and desktop `1440x1000`; it exercised summary, performance, transactions, CSV export, keyboard focus, and accounts tabs. Browser console/page/HTTP/request diagnostics were empty.
- The focused authenticated browser scenario `investor-finance-history` passed at mobile `390x844` and desktop `1440x1000`. It verifies the account view, history endpoint/rendering, separate physical-cash and rights panels, Investor/Pengelola payout actions, rights-transfer target selection, optional physical-movement toggle, and no horizontal overflow. Form controls were exercised without submitting/persisting a financial mutation; browser diagnostics were empty.
- The full `pnpm test` suite reported 38 files, 206 tests: 37 files passed, 202 tests passed, 4 tests failed. All four failures are in the unrelated `src/tests/inventaris.test.tsx` UI suite (physical-unit facts, trusted registration empty state, mobile detail link, and mobile vocabulary/actions). The remaining tests, including both Investor test files, passed. No Inventaris changes were made.

## Release boundary

- No commit, deployment, production release, or persistent payout/transfer test record was created.
- Remaining unrelated blockers to a fully green repository-wide verification are the 4 existing Inventaris UI test failures. The investor finance implementation's focused tests, typecheck, build, authenticated rollback smoke tests, and focused mobile/desktop browser checks passed.


## Continuation — Frontend contract, period config, and Investor self-transfer

- Additional Supabase migration applied: `20261010025120_investor_self_service_transfer`; local file `supabase/migrations/20261010025120_investor_self_service_transfer.sql`, SHA-256 `cfcfaffbefd8777f9e016d1fb19ea32c8daa206d4e6a2b190ccb7f477dec7831`.
- Self-transfer data shape is distinct from allocation payout: `payout_kind=investor_self_transfer`, no period/allocation IDs, audited Investor actor, no operational-result impact. RLS remains enabled; public RPC is executable by `authenticated`, not `anon`.
- Postflight confirmed migration version, RLS, execute grants, zero persisted payout/self-transfer/rights-transfer test rows, and Investor demo physical balance remains `50000.00`.
- Security smoke test in an explicit rollback transaction confirmed that the available dual admin/Investor UAT identity is resolved admin-first and is rejected from the Investor self-transfer command. A successful RPC call under an Investor-only JWT was not run because that auth identity was not available. Frontend self-transfer success path is covered by mocked RPC tests; do not represent that as an end-to-end authenticated happy-path test.
- Investor UI now resolves viewed dates through `get_investor_overview(p_as_of_date)` and uses the server-returned configured period boundaries for period navigation/activity reads; future navigation is blocked. Closing uses the selected server-resolved period and an explicit summary confirmation. Financial action availability is represented in `buildInvestorUiContract`; stale/review/incorrect-principal/incorrect-period cases disable actions.
- Config UI now exposes configured start/end days and initializes from effective-dated configuration per Investor. It fetches the active Usaha timezone, checks period range and percentage/reserve values, and disables save until timezone and operator dependencies are verified. No config mutation was run during verification.
- Investor-principal Accounts tab now shows only accounts assigned to that Investor and can record transfer-out only from that account; UI confirms it records a real-world transfer already performed, not a bank payment initiation. Admin Akun Uang screen displays recorded Investor and Pengelola balances separately from operating-account totals.
- Open-period admin advances use the existing secured payout RPC with `allocationId=null`, the current configured period start, and an operating source account; the UI requires real external payment, validates amount versus estimated right/source cash, blocks multi-currency operating pools, and refreshes reads. It is never shown for stale/review/closed/historical periods.
- Closing-period settlement/rights-transfer cards are filtered to the selected backend-resolved period only. Rights-transfer controls appear only when the selected contract allows closed-period operations.
- Targeted validation after this continuation must be recorded below once complete. Previous verified targeted suite: 4 Investor test files, 19 tests passed, typecheck and ESLint passed before the final contract capability and period-filter changes.
