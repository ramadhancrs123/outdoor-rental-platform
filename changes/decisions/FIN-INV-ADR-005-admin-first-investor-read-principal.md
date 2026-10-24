# FIN-INV Backend Decision — Admin-First Read Principal

Status: ACCEPTED
Date: 2026-10-10
Scope: Investor finance read-model authorization and UI capability consistency

## Context

The application identity resolver in `src/app/providers/auth.ts` selects an active admin identity before attempting Investor identity resolution. The database read-access helper previously checked active Investor identity first. A single authentication user that had both an active `akun_admin` membership and an active Investor row for the same business could therefore be treated as Investor in database read models, although the application treated the user as Admin. This caused the investor account view to omit administrator-only allocations and payout/rights-transfer controls.

## Decision

1. For Investor finance read models, require an authenticated principal.
2. Prefer an active `super_admin` whose `keanggotaan_usaha` is active, not revoked, and scoped to the requested active `usaha`.
3. Only when that scoped admin membership does not exist, resolve an active Investor row for the requested business.
4. If neither condition holds, reject access. A global admin role alone does not grant cross-business access.

## Consequences

- Frontend identity and database read models resolve the same principal for a given business.
- Investor-only users retain Investor-level read access.
- Administrator-only allocations, history, payouts, and rights transfers become visible only within an active business membership.
- The authorization precedence is implemented by `supabase/migrations/20261010015838_investor_finance_read_principal_precedence.sql` and verified with authenticated-role SQL read checks plus the investor finance browser scenario.

## Safety Boundary

This read-principal correction does not change payout semantics, operational result calculations, or the rights/cash separation adopted by FIN-INV-ADR-004. No production deployment or commit is implied by this decision.
