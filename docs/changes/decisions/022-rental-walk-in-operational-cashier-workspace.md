# ADR 022 — Rental Walk-in sebagai Operational Cashier Workspace

**Status:** ACCEPTED
**Date:** 2026-10-05
**Scope:** Panel Admin — Penyewaan Langsung / Walk-in Rental

## Context

Golden-path walk-in rental is an operational cashier task. The operator must complete renter, period, catalog, cart, payment, automatic unit assignment, handover, activation, and transaction output without navigating through separate workspaces.

The existing backend/domain semantics remain canonical:
- Penyewaan owns rental, schedule, assignment, and handover truth.
- Keuangan owns payment and financial transaction truth.
- Inventaris owns physical unit and readiness truth.
- Receipt and QR infrastructure remain canonical.

## Decision

The Walk-in page is implemented as one operational cashier workspace.

Desktop uses a two-area layout when width allows:
- Catalog / rental context on the working area.
- Cart, payment, and operational state on the action area.

Mobile follows:
Konteks → Katalog → Keranjang → Pembayaran → Unit → CTA

The previous wizard/stepper is not the golden path.

The UI remains a trusted orchestration client:
- direct rental creation still uses command_create_direct_rental
- payment still uses the existing Finance payment command
- activation still uses command_operational_activate_rental
- server remains authority for tariff periods, price, subtotal, availability, assignment, and activation
- idempotency and reconciliation remain mandatory

Payment mode labels are UX-only:
Belum Bayar / DP / Lunas

They map to existing payment semantics and do not create a new Finance payment type.

## Backend Security Boundary

Operational command public wrappers are trusted entry points. The public wrappers use SECURITY DEFINER and keep app_private commands closed to authenticated.

This preserves the intended boundary rather than granting direct execution on private command functions.
