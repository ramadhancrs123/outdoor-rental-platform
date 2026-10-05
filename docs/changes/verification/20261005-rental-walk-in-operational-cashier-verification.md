# Verification — Rental Walk-in Operational Cashier Workspace

**Date:** 2026-10-05  
**Status:** VERIFIED FOR FEATURE SCOPE

## Target

Redesign src/pages/penyewaan/walk-in.tsx into a single operational cashier workspace matching the supplied reference flow:
renter → period → catalog → cart → payment → auto-assignment → handover → active rental → QR/receipt output.

## Implemented

- compact rental context header
- inline rental period preview and >24h warning
- compact catalog cards with search/category/ready stock
- item/package add flow
- tariff-period price formula in the add dialog
- compact editable cart
- inline DP/Lunas payment UX
- Finance account + payment method selection
- auto-assignment as default golden path
- manual assignment remains exception path
- operational handover/activation CTA
- QR Penyewaan output
- 58 mm receipt output
- compact sticky mobile CTA

## Business Semantics Preserved

- calculateRentalPeriodPreview()
- calculateTariffPeriods()
- calculateRentalLineSubtotal()
- command_create_direct_rental
- existing Finance payment command
- command_operational_activate_rental
- idempotency / unknown-outcome handling
- server authority and tenant/RLS behavior
- existing QR and receipt infrastructure

## Browser Evidence

Mobile 375×812: PASS
- renter selection
- 24h + 1m period
- inline >24h warning
- catalog selection
- period × tariff calculation
- cart
- inline DP
- activation
- success output
- QR and 58 mm receipt actions
- zero console/page/http/request errors

Desktop 1280×800: PASS
- same end-to-end flow
- zero console/page/http/request errors

## Database Evidence

Latest browser-created dummy rental reached active with:
- assignment present
- handover record present
- QR rental record active
- DP payment amount recorded
- payment linked to a Finance transaction
- Finance transaction source linked to the rental

The data is dummy/test state only.

## Regression Validation

Focused tests:
- src/tests/operational-workspace-contract.test.ts: 5/5
- src/tests/rental-operational-workspace.test.tsx: 2/2
- src/tests/penyewaan.period-preview.test.ts: 5/5
- src/tests/penyewaan.test.tsx: 3/3
- total focused: 15/15 PASS

Affected-scope ESLint: PASS  
git diff --check: PASS  
TypeScript tsc --noEmit: PASS after final frontend runtime guard changes.

## Full-suite Note

A full Vitest run is not green because four failures occur in src/tests/inventaris.test.tsx. Those files are outside this mission scope and were already part of the dirty worktree. The rental workspace focused suite remains green.

## Production

No production deployment, promotion, commit, or push was performed.
