# Backend Phase 1 Verification — 2026-10-05

Status: VERIFIED FOR CURRENT DUMMY SUPABASE ENVIRONMENT

## Implemented

- Operational rental activation orchestration.
- Auto-assignment for non-package and package lines.
- Auto-assignment duplicate-unit guard within the same rental.
- Operational unit return → inspection orchestration.
- Conditional maintenance handoff.
- Unit-scoped readiness for partial return.
- Operational rental read contract.
- Operational return/readiness read contract.
- Explicit authenticated RPC grants.
- ADR-019 documenting the new backend semantics.

## Live migrations applied

- 20261005032359_operational_rental_workspace_backend
- 20261005033030_operational_return_workspace_backend
- 20261005033630_fix_operational_auto_assignment_duplicate
- 20261005033730_fix_operational_auto_assignment_candidate_alias
- 20261005033930_fix_partial_return_readiness_gate

## Live verification

- Direct rental activation: PASS.
- Auto-assignment quantity >1 with unique physical units: PASS.
- Package with multiple physical components: PASS.
- Normal return: PASS.
- Normal inspection creates no maintenance task: PASS.
- Partial return keeps rental return_in_progress while returned unit can become READY: PASS.
- Issue/dirty return creates one maintenance task: PASS.
- Maintenance start → complete → verification → READY: PASS.
- Idempotent retry: PASS.
- Tenant isolation: PASS.
- Pricing manipulation for duration period / unit price / subtotal rejected: PASS.
- Operational read contracts: PASS.
- Relevant service tests: 55 passed across 6 test files.

All integration fixtures were executed inside transactions and rolled back.

## Security / integrity

- RLS remains enabled on rental, assignment, return, inspection, maintenance, idempotency, outbox, and unit tables.
- Public orchestration/read functions are executable by authenticated users; private orchestration functions are not exposed to PUBLIC/anon.
- Existing domain ownership, audit, outbox, and idempotency boundaries remain intact.

## Current state

- Core operational dummy transaction tables remain clean after verification.
- Existing dummy inventory/usaha records were not deleted.
- Frontend/UI was not modified as part of Phase 1.

## Gate

Phase 1 backend implementation is complete for the current dummy Supabase environment.

Phase 2 (frontend contract) and Phase 3 (UI/UX) are intentionally NOT started.
