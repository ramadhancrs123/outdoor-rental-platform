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

Other outbox events are still preserved as domain event history. The production allowlist is expanded by the amendment at the end of this ADR.

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

In-app notification records remain canonical. FCM is best-effort delivery only: push status never changes business state, never replaces the in-app notification, and must carry the source `outbox_event_id` for idempotency and tracing. WhatsApp delivery is not part of the active delivery policy. The current FCM allowlist is maintained by the production amendment below.

### Operational scheduling

The trusted consumer exists as a SECURITY DEFINER database command and a service-role-only wrapper. A production scheduler/Edge Function invocation is a separate operational deployment concern and must pass the normal production approval gate.

## Consequences

The Panel Admin can safely expose notification count, list, read-state, and source deep links without creating a second source of truth. Notification reliability can be reconciled directly from outbox state.

## Verification notes

The live database processed the currently existing pending events successfully after one runtime correction to the conflict clause. A repeated consumer run produced no additional notification rows, providing direct idempotency evidence for those event IDs.


## Production amendment — 2026-10-25

This amendment supersedes the earlier Phase 1 delivery restriction and is the active production policy for the deployed FCM/outbox pipeline.

### Additional notification events

The consumer creates in-app notifications for `rental.created`, `rental.return_due`, `rental.tolerance_started`, `rental.tolerance_warning_2h`, `rental.tolerance_warning_1h`, `rental.tolerance_warning_30m`, `rental.tolerance_expired`, `rental.late_fee_applied`, `rental.late_fee_accrual_reminder`, `payment.completed`, `rental.extension_requested`, `rental.extension_approved`, `rental.extension_rejected`, `damage.found`, `damage.check_scheduled`, `profit.shared`, and `payout.completed`, in addition to the original events listed above.

### Push allowlist

FCM push delivery is enabled for `rental.created`, `rental.picked_up`, `return.completed`, `payment.recorded`, `payment.completed`, rental return/tolerance deadline events, `rental.late_fee_applied`, `rental.late_fee_accrual_reminder`, `damage.found`, and `rental.extension_requested`. All other in-app events remain available in the admin notification inbox without creating a push unless the policy is changed explicitly.

### Payment settlement contract

A payment with status `recorded` is an accepted ledger entry, not a separate `completed` status. `payment.completed` is emitted only when the sum of recorded, non-reversed base-rental payments crosses the rental's `total_amount`; penalty and extension payments are excluded. The outbox snapshot contains the cumulative paid amount and the rental total. A recorded DP therefore generates `payment.recorded`, while the transaction that settles the rental also generates `payment.completed`. Processing delivery is based on the event snapshot rather than a later payment status mutation.

### Late-fee reminders

While a rental is active/awaiting return after its tolerance deadline, the daily scheduler emits one idempotent `rental.late_fee_accrual_reminder` per rental per business-local day. The message displays the estimated billable hours and estimated accrued amount from `late_fee_per_hour`. It is explicitly labelled an estimate: final liability is calculated when return is completed and remains subject to Finance review. The deadline scheduler continues to issue the immediate tolerance-expired event separately.

### Source integrity

Revalidation supports all row-backed event types above. Extension notifications deep-link to the parent rental; damage notifications resolve through `temuan_pemeriksaan → pemeriksaan → unit_barang` because a damage finding does not own a unit ID directly. Missing/unsupported source types must be reported as unavailable; existing rows must never be marked unavailable merely because an event type lacks a revalidation branch.


### Immediate tolerance-expiry amount

The `rental.tolerance_expired` notification calculates an hourly-rate estimate from the rental's tenant policy and elapsed time beyond the tolerance deadline. The message includes estimated rupiah amount, billable hours, and hourly rate when the policy has an active nonzero rate; otherwise it reports that no active fee can be estimated. The notice explicitly states that the amount is an estimate and that Finance verifies the final charge at return completion.


### Finance consequence review events

The `rental.consequence_review_required` notification alerts Finance that a rental has a candidate late fee, damage, loss, or missing-component amount awaiting review. It must clearly state that the candidate amount is not yet a final charge and does not create a payment. The `rental.consequence_reviewed` notification reports the recorded Finance approval or rejection and links to the parent rental. Neither event can automatically charge the renter; payment remains available only through the approved Finance workflow.
