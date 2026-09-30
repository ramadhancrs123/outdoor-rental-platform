# Public RPC Boundary Hardening — 2026-09-30

## Problem

Runtime browser verification showed that an authenticated admin request to an app_private RPC returned HTTP 404 through the Supabase PostgREST API. Unit tests had mocked supabase.rpc() and therefore could not prove runtime reachability.

## Decision

Keep app_private internal. Expose only the frontend-called trusted commands/queries through public SECURITY INVOKER wrappers. The wrapper delegates to the existing app_private function, preserving its tenant authorization, state validation, transaction and idempotency semantics.

## Security boundary

- app_private helper functions remain unexposed.
- Public wrappers revoke execution from PUBLIC, anon, and service_role.
- Public wrappers grant execution only to authenticated.
- Wrapper search_path is empty and calls the fully qualified app_private function.
- No business logic is added to the wrapper.

## Evidence

Before hardening:
- Authenticated browser probe of command_reconcile_maintenance_mutation returned HTTP 404 from PostgREST.
- app_private functions existed and had authenticated grants, but direct browser reachability was not established.

After migration:
- Re-run the same authenticated probe.
- Re-run the full Vitest suite.
- Re-run browser matrix.
- Verify wrapper grants and no anonymous execution.

## Production gate

This change is required before manual acceptance and before production promotion.