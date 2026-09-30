# LIFECYCLE-ADR-001 — Maintenance Verification Authority

Status: FINAL / MASTER CONTROL SESSION 1
Date: 2026-09-28

Decision:

Verification setelah maintenance adalah explicit trusted mutation pada boundary backend.

Verification memiliki dua hasil: passed dan failed.

Ownership:
- Perawatan owns maintenance completion and verification context.
- Inventaris owns the final physical state.
- Verification pass may transition a completed-maintenance unit from maintenance to ready.
- Verification failure leaves the unit in maintenance.

Fase awal tidak menambah tabel verification baru. Verification fact dicatat melalui trusted command response, riwayat_unit, audit_log, and outbox_event.

Trusted command:
command_verify_maintenance_readiness

Critical mutation:
authorization
tenant isolation
advisory locking
stale-state guard
idempotency
unknown-outcome reconciliation
audit
outbox

Pass:
maintenance completed + explicit verification passed -> Inventory unit READY.

Fail:
maintenance completed + verification failed -> Unit remains maintenance.

Source-less maintenance:
pemeriksaan_id may remain NULL under MNT-ADR-001. Such maintenance can still be explicitly verified through this command. No synthetic Inspection record is required merely to reach READY.

UI boundary:
completed -> verification required
verification failed -> remains unavailable
verification passed -> Inventory reports READY

UI must never perform generic status mutation.
