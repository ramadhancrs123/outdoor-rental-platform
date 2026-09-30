# ADR — Notification Event Consumer Policy

> **Status:** ACCEPTED — final integration baseline
> **Decision date:** 2026-09-29
> **Scope:** Pemberitahuan / Outbox / Admin Panel
> **Risk:** HIGH
>
> This ADR defines the implementation policy for transforming committed domain events into admin notification records. It does not change business ownership.

## Decision

Notification follows:

```text
Business Fact
→ Domain Event
→ Outbox
→ Notification Consumer
→ Notification Record
→ Admin
→ Source Workflow
```

Pemberitahuan remains Attention/Delivery Record and never becomes a source of business truth.

### Recipients

Phase 1 recipients are active `super_admin` memberships inside the same Usaha as the event. Tenant membership remains authoritative.

### Notification policy

The consumer currently creates admin notifications for these explicit events:

| Event | Source owner | Action target |
|---|---|---|
| `reservation.confirmed` | Reservasi | `/reservasi/:id` |
| `rental.picked_up` | Penyewaan | `/penyewaan/:id` |
| `return.completed` | Pengembalian | `/pengembalian/:id` |
| `inspection.maintenance_required` | Pemeriksaan | `/pemeriksaan/:id` |
| `maintenance.completed` | Perawatan | `/perawatan/:id` |
| `payment.recorded` | Keuangan | `/keuangan/pembayaran/:id` |
| `expense.recorded` | Keuangan | `/keuangan/pengeluaran/:id` |
| `inventory.unit_inspection_pending` | Inventaris | `/inventaris/:id` |
| `inventory.unit_ready` | Inventaris | `/inventaris/:id` |

Other outbox events are still preserved as domain event history but intentionally do not create a notification unless the policy is expanded by a documented decision.

### Idempotency

`pemberitahuan.outbox_event_id` correlates a notification with its source outbox event. A unique tenant/recipient/event constraint prevents duplicate notification records. The consumer uses `FOR UPDATE SKIP LOCKED` and processes one event at a time per locked row.

### Failure semantics

If notification processing fails:
- the source business transaction remains committed;
- the outbox event becomes `failed`;
- retry is scheduled through `next_attempt_at`;
- the source event is not deleted;
- notification records already committed are not deleted by delivery failure.

### Deep-link semantics

Opening a notification is navigation only. The target workflow must re-read the current source record and enforce its normal authorization and business rules. A stale notification must never be treated as current business state.

### Delivery transport

Phase 1 in-app notification records are the canonical admin attention surface. Push/WhatsApp delivery is not introduced as a business dependency in this decision. A future delivery transport must consume notification records without mutating domain state.

### Operational scheduling

The trusted consumer exists as a SECURITY DEFINER database command and a service-role-only wrapper. A production scheduler/Edge Function invocation is a separate operational deployment concern and must pass the normal production approval gate.

## Consequences

The Panel Admin can safely expose notification count, list, read-state, and source deep links without creating a second source of truth. Notification reliability can be reconciled directly from outbox state.

## Verification notes

The live database processed the currently existing pending events successfully after one runtime correction to the conflict clause. A repeated consumer run produced no additional notification rows, providing direct idempotency evidence for those event IDs.
