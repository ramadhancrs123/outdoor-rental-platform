# A5 — Receiving Boundary Baseline Decision

Status: ACCEPTED BASELINE / NO SEMANTIC EXPANSION

## Context

Assignment 5 validates the commercial and financial integration boundary:

`Pembelian → Receiving → Inventaris`

The canonical Pemasok/Pembelian contract explicitly states:

- Pembelian ≠ Penerimaan.
- Receiving is a distinct physical fact.
- The current baseline does not model an explicit receiving entity.
- An agent must not invent a receiving entity or infer receiving state from purchase status.
- Purchase provenance may still be preserved when an Inventory unit references `detail_pembelian`.

## Decision

For the current baseline and Assignment 5:

1. No receiving table/entity/status/quantity is invented.
2. `serah_terima` is not treated as procurement receiving because it belongs to the rental handover domain.
3. `unit_barang.sumber_pembelian_detail_id → detail_pembelian` remains the verified purchase-to-inventory provenance boundary.
4. Any future receiving workflow, including partial receiving semantics, requires a separate ADR/ERD/database change.
5. Assignment 5 may verify the existing boundary as **deferred by baseline**, but must not represent purchase as received.

## Consequence

The current system can prove:

`Purchase → Purchase Detail → Inventory provenance`

but cannot claim a procurement receiving event. This is intentional and preserves domain correctness.

## Evidence

- canonical Pemasok/Pembelian rules
- live Supabase schema inspection
- no procurement receiving entity in `public`
- purchase provenance orphan check = 0

No business semantic is added by this decision.
