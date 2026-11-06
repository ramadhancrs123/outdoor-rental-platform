# Phase 6 — Internal Finalization Report

**Status:** Engineering verification completed for the internal admin scope. Business activation settings remain intentionally unconfigured.

## Scope

Included: Event & Promosi admin, catalog/product promotions, package-promotion admin read path, Loyalty Model A, checkout discount policy, mixed rental + retail checkout, finance reporting, audit traceability, RLS/permissions, idempotency/reconciliation, and operational regression.

Explicitly excluded by product direction: public website promotion/catalog and reservation workflows. No public read model or reservation flow was changed or tested in this finalization pass.

## Production corrections applied

| Migration version | Migration | Purpose |
|---|---|---|
| 20261105225700 | event_promotion_parent_rental_variant_tariff_eligibility | Initial adjustment to parent-level rental promo eligibility. |
| 20261105225805 | event_promotion_variant_tariff_parent_lookup | Correct lookup for tariffs stored against variants, where tarif_sewa.barang_id is NULL for variant-owned tariffs. |

The second migration is the final function definition. Both migration records are present in production and local filenames now match the recorded versions.

The regression exposed a real case: Jaket Gorpcore has rental tariffs owned by variants, not by the parent product. A parent-level rental promotion was incorrectly rejected before the lookup correction. The corrected function is now verified against the actual product/variant/tariff structure.

## Database transaction QA — all rolled back

Tests used actual tenant catalog, tariff, inventory-unit and Kas Operasional account records. Temporary promotions, policy and loyalty settings, sales, rentals, assignments, audit events, idempotency rows, and finance movements were created only inside rollback transactions.

Verified scenarios:
- Parent-level rental promo is accepted for a product whose tariffs are variant-owned.
- Variant promotion overrides parent promotion.
- A sibling variant without its own promotion falls back to the parent promotion.
- Promotion channel isolation: rental promo does not resolve on sale; sale promo does not resolve on rental.
- Promotion validity window expiry is respected.
- Loyalty Model A: a customer at threshold is eligible; below threshold is not; raising threshold immediately removes eligibility for the next preview.
- Manual checkout discount is applied only to rental subtotal.
- Mixed checkout total, payment status, and amount paid reconcile.
- Identical idempotency retry returns the original response; changed payload on the same key is rejected.
- Checkout reconciliation returns the committed result.
- Direct mixed checkout + activation with loyalty discount succeeds and assigns a real rental unit.
- Activation retry is idempotent and reconciles to committed.
- Serialized sale consumes real sellable units; rental activation assigns the rental unit.
- Cash movements equal actual sale payments only. Checkout discount creates no cash movement.
- Discount snapshot and audit records are written with request traceability.

Expected calculation in the test:
- Rental after catalog promo: Rp4.500.
- Manual rental discount: Rp450.
- Sale after sale promo: Rp9.000.
- Mixed checkout net: Rp13.050; paid at checkout: Rp9.000; payment state: partial.

Direct activation + loyalty scenario:
- Rental subtotal after catalog promo: Rp4.500.
- Loyalty recommendation and applied discount: Rp225.
- Sale after sale promo: Rp9.000.
- Mixed checkout net: Rp13.275; paid at checkout: Rp9.000.
- Rental activation succeeded and assigned one real Matras unit.

Post-rollback checks found no QA promotion, checkout policy, loyalty configuration, discount snapshot, QA idempotency key, rental/sale record, or cash movement remaining. Inventory stayed at the pre-test values: Matras 15 ready / 0 sold; Jas Hujan 11 ready / 1 sold. Existing business sales, rental, audit and cash records remained.

## Security and performance

- Promotion, loyalty, discount snapshot, checkout policy and permission tables have RLS enabled with tenant-member read policies.
- Sensitive table writes remain behind trusted commands; direct anon writes are not granted.
- Promotion create, loyalty set, checkout policy set, mixed checkout, and activation RPCs are executable by authenticated, not anon.
- The promotion command enforces event_promotion.manage; discount application and override use their own capability checks.
- Existing targeted indexes cover promo resolution, loyalty completed-rental lookup, discount snapshots, checkout history and audit lookup. No speculative index was added.
- Global Supabase advisor findings include unrelated modules and were not modified as part of this scoped finalization.

## Browser verification

Read-only / pre-submit browser scenarios completed at both mobile 390×844 and desktop 1280×800:

| Scenario | Mobile | Desktop |
|---|---|---|
| Event & Promosi admin tabs | VERIFIED | VERIFIED |
| Analisis Retail | VERIFIED | VERIFIED |
| POS catalog and checkout review (no submit) | VERIFIED | VERIFIED |

All six runs reported no console errors, page errors, HTTP errors, request failures or horizontal overflow. POS test only added an in-memory cart line and opened checkout review; no transaction was submitted.

## Automated regression

- Vitest: **7 files passed, 54 tests passed** across rental, sales, finance and catalog.
- ESLint: feature-scope files passed.
- TypeScript: npm run typecheck passed.
- git diff --check passed.

## Operational setup still required

These are business setup decisions, not migration failures:

1. The business currently has no checkout discount policy row. Manual discount therefore remains safely unavailable until the owner sets its maximum amount/percentage, reason requirements and allowed reason codes.
2. The business currently has no loyalty configuration row. Model A is implemented and tested, but no recommendation is offered until the owner sets threshold, percentage and validity.
3. The business currently has no package records. Package-promotion admin renders correctly, but a package transaction cannot be tested with real tenant data until a package exists.
4. The existing historical Jas Hujan sale has unknown HPP. Reporting correctly leaves its HPP and gross profit unknown instead of fabricating a cost.

No default values were invented or written to production.

## Release boundary

No commit, push or deployment was performed. Public website and reservation work remain excluded, including finalization.
