# ARD-002 — AKASHA SMART BOOKING (Observational Booking)

> **Status:** Implemented backend foundation — customer/admin UI and final checkout orchestration remain separate phases.  
> **Scope:** Website booking, booking-scoped customer access, read-only availability projection, customer change requests, admin workflow.  
> **Related decisions:** `ADR-004 — Reservasi Tidak Mengunci Unit`, `ADR-009 — Website Self-Service Booking (Draft Reservasi)`.  
> **Business boundary:** Rental Outdoor / Akasha Outdoor only. No cross-tenant sharing.

---

## 1. Purpose

AKASHA SMART BOOKING records customer intent from the public website and provides a booking-scoped way for customer and admin to follow that request until the customer arrives.

It is not a capacity reservation, physical-unit allocation, rental transaction, sale transaction, payment, or stock movement.

```
Booking record
    ≠
Stock commitment
    ≠
Physical unit assignment
    ≠
Rental / sale transaction
```

## 2. Relationship to existing decisions

### ADR-009 — Website draft reservation

ADR-009 remains the baseline for the legacy website reservation record:
- Rental website submission creates a linked request and `reservasi` with `status = draft`.
- `stock_lock_status = not_locked`.
- The customer is not told that a rental is confirmed.
- Admin cancellation is a state transition, not hard deletion.
- Existing `qr_reservasi` remains an operational admin QR; it is not repurposed as the customer portal session secret.
- WhatsApp remains a user-initiated draft message; no automated delivery is introduced.

This implementation wraps the ADR-009 rental command rather than redefining its historical data contract.

### ADR-004 — Capacity commitment versus physical unit

ADR-004 continues to govern legacy reservation capacity semantics and the distinction between capacity and a physical unit.

AKASHA SMART BOOKING introduces a narrower online-booking workflow: an online request stays observational and does not call `command_confirm_reservation`. Admin acknowledgement or `ready_for_checkout` does not create a capacity lock. The workflow uses its own status axis, linked to the legacy draft record.

This is a scoped business refinement for online bookings. It does not silently reinterpret old confirmed/locked reservations.

### Booking-scoped customer access

ADR-009's prohibition on customer accounts remains respected. This feature does not create a Supabase Auth customer identity or permanent customer account.

The portal uses a booking-scoped access exchange:
- customer supplies the booking reference and memorable access code;
- server exchanges them for a short-lived session scoped to that booking;
- session cannot access other bookings or tenant data.

This is not customer account registration; it is a temporary access mechanism for one booking.

## 3. Booking lifecycle

The Smart Booking aggregate has its own workflow states:

```
received
  → reviewing
  → acknowledged
  → ready_for_checkout
```

Additional branches:
- `customer_action_required`
- `change_requested`
- `cancellation_pending`
- `cancelled`
- `expired`
- `fulfilled`

Meanings:
- `received`: the online request was accepted.
- `reviewing`: admin is reviewing it.
- `acknowledged`: admin has reviewed it; this is not a stock guarantee.
- `customer_action_required`: customer must provide clarification.
- `change_requested`: customer requested an item, variant, quantity, or schedule change.
- `cancellation_pending`: customer cancellation request awaits admin review.
- `ready_for_checkout`: the booking is a reference for the upcoming visit, not a stock guarantee.
- `cancelled` / `expired`: the booking workflow is closed.
- `fulfilled`: a later operational checkout converted the request into actual transactions. The final checkout command is not part of this backend foundation.

The linked legacy `reservasi.status` remains `draft` while this observational workflow is active. Admin acknowledgement must not map to legacy `confirmed`.

## 4. Data boundaries

### Booking aggregate

`app_private.akasha_smart_booking` is the workflow aggregate and stores tenant and legacy links, customer contact snapshot, pickup/return dates and optional exact timestamps, business timezone, quote total, revision, workflow and review facts.

`app_private.akasha_smart_booking_line` stores customer-requested lines:
- `rental` lines;
- `sale` lines;
- product, variant, or package references;
- immutable display and price snapshots.

Sale intent is not inserted into `detail_penyewaan` or `detail_penjualan`. Rental and sale remain separate operational domains.

### Access and sessions

Private tables:
- `akasha_smart_booking_customer_access`
- `akasha_smart_booking_customer_session`
- `akasha_smart_booking_access_throttle`
- `akasha_smart_booking_create_throttle`

The memorable access-code format is:

```
normalized-first-name + pickup-year + 3-character HMAC suffix
nurdin2026Q1A
```

Rules:
1. The memorable suffix is at most three characters.
2. Ambiguous characters are excluded from the generated suffix alphabet.
3. The public booking reference is separate and required alongside the access code.
4. The complete access code is not stored in plaintext; the database stores a keyed HMAC.
5. The HMAC pepper lives in Supabase Vault.
6. Credential rotation revokes active sessions and issues a new code version.
7. Failed attempts are throttled; device fingerprints are stored only as keyed HMACs.
8. Session tokens are stored as HMAC hashes and delivered to the web server for an HttpOnly cookie.

A first name/year/three-character suffix is memorable, not a high-entropy password. It must always be paired with the opaque booking reference, server-side throttling, lockout, expiry, and session revocation.

## 5. Availability projection

Availability is a read model, not a reservation or an allocation command.

For rental lines the projection returns:
- ready stock across all variants of the product;
- ready stock for the exact requested variant;
- potential returns before pickup across variants;
- potential returns before pickup for the requested variant;
- a status signal for ready stock, other-variant alternatives, potential returns, or shortage.

For sale lines it returns current saleable quantity:
- quantity inventory uses `stok_barang`;
- serialized inventory uses eligible ready physical units.

For package lines it evaluates each package component separately.

### Temporal and inspection rules

- The business `default_tolerance_hours` is used when estimating potential returns.
- If an exact pickup timestamp exists, it is the forecast boundary.
- If only a date exists, the beginning of that local business date is used as a conservative boundary.
- An active rental or return-in-progress unit remains unavailable.
- Existing legacy reservations with `stock_lock_status = locked` and status `confirmed/converted` are deducted for the overlapping rental date range through the existing capacity-lock resolver. This preserves legacy commitments without creating new locks for Smart Booking records.
- Potential returns are reduced conservatively when part of the existing legacy capacity commitment must be fulfilled by expected returns.
- A potential return is never counted as ready stock.
- A returned unit is ready only after the existing return and inspection process makes its physical state eligible.
- Every response includes `checked_at` and explicit flags that inventory is not reserved and availability is not guaranteed.
- The customer projection excludes physical unit IDs/codes, other renter identities, and internal notes.

Final operational checkout must revalidate availability atomically. The projection can become stale immediately after it is read.

## 6. Customer change workflow

The customer portal can submit requests for item, variant, quantity, schedule, cancellation, alternative interest, or clarification.

A request is recorded in `akasha_smart_booking_change_request` and creates activity/outbox events. It does not directly mutate booking lines, rental rows, sale rows, or inventory.

Current backend resolution support:
- schedule changes update Smart Booking dates and linked legacy request/reservation date fields;
- cancellation calls the existing trusted reservation cancellation command for the linked legacy draft;
- item/variant/quantity approvals remain pending for a dedicated item-editor command and must not be applied by generic status mutation.

Mutations use an expected revision to prevent stale updates from overwriting newer booking state.

## 7. Admin command boundary

Admin reads require an active tenant membership.

The admin read model exposes:
- paginated booking queue and search;
- booking detail, line snapshots, customer requests, and public/internal activity;
- a read-only availability projection for each requested line, including global product stock, exact-variant stock, potential returns, tolerance, and package component breakdown.

The admin availability projection uses the same calculation helpers as the customer portal. It does not reveal physical unit identifiers and does not allocate stock.

Admin mutations require `reservation.amend`. Access-code rotation requires `access_control.manage`.

Commands write audit records and outbox events where appropriate. Direct browser writes to private booking tables are not granted.

## 8. API boundary

The public website calls Next.js Route Handlers. These invoke the `akasha-smart-booking` Supabase Edge Function.

The Edge Function:
- has JWT verification enabled;
- owns the trusted server-side Supabase client;
- reads Supabase secret credentials only from the Edge Function environment;
- requires a second server-only ingress header in addition to the public Supabase JWT;
- validates that ingress credential through a service-role-only RPC against a secret held in Supabase Vault;
- routes `create`, `login`, `portal`, `availability`, `change`, and `logout`;
- returns no-store responses.

The matching `AKASHA_SMART_BOOKING_INGRESS_SECRET` is configured as a sensitive Vercel environment variable for production, preview, and development, and separately stored in Supabase Vault. It is not a `NEXT_PUBLIC_*` variable and is never sent to browser JavaScript. The Edge Function rejects direct calls that have only the public Supabase anon/publishable key.

The Next.js application does not receive a service-role/secret key. After login, the customer session is held in a Secure/HttpOnly/SameSite cookie and is not returned to browser JavaScript.

## 9. Security and integrity invariants

1. Tenant is resolved server-side from the configured business slug.
2. Customer-supplied tenant IDs, statuses, stock locks, prices, and transaction IDs are not trusted.
3. Rental prices are resolved by the existing trusted website booking command.
4. Sale prices and current sale promotions are resolved server-side from catalog truth.
5. Booking creation is idempotent; same key with a different payload is rejected.
6. Booking data tables are private, RLS-enabled, FORCE RLS, and have no direct application-role grants.
7. Customer access functions expose only the sanitized projection.
8. Customer change requests are not direct mutations.
9. Admin writes enforce tenant permission and revision checks.
10. Acknowledgement never reserves capacity.
11. Availability reads never change inventory.
12. Actual rental/sale checkout remains the only point where inventory is revalidated and operational transactions are created.
13. The legacy `command_create_website_booking` RPC is not directly executable by `anon` or `authenticated`; public website traffic enters through the authenticated Edge Function ingress.
14. Legacy confirmation/cancellation commands cannot accidentally lock or independently cancel a reservation linked to a Smart Booking. Permission-checked Smart Booking commands use a reservation-scoped transaction-local context when invoking the legacy cancellation command. Unlinked legacy reservations keep their existing confirm/lock/cancel behavior.

## 10. Explicit non-goals of this backend phase

Not implemented by this backend foundation:
- customer-facing portal UI pages;
- QR artwork/receipt generation for the customer portal;
- automatic WhatsApp or push notifications;
- realtime inventory streaming;
- stored availability-history charts;
- automatic alternative selection;
- final item-edit approval command;
- walk-in checkout prefill and atomic rental + sale conversion;
- checkout payment orchestration;
- Vercel deployment of website changes.

No inventory lock, physical assignment, rental, sale, payment, or stock movement is created by booking submission.

## 11. Acceptance evidence

Production backend checks were run using transaction-scoped create/login/portal/change/availability tests that end in `ROLLBACK`.

Validated:
- mixed rental + purchase intent is stored in separate line kinds;
- first-name/year/three-character access code is returned;
- reference + access code exchanges for a portal session;
- customer change request is recorded as pending;
- customer projection returns sanitized booking lines, changes, and public timeline;
- availability returns global and exact-variant counts and sale quantity;
- `inventory_is_reserved = false`;
- `availability_is_guaranteed = false`;
- requested sale quantity greater than current stock returns `insufficient_quantity`;
- the read-only availability helper receives the requested rental date interval and deducts overlapping legacy capacity locks, while leaving Smart Booking itself unlocked;
- a database-backed ingress check accepts the provisioned secret and rejects malformed or incorrect values;
- a direct Edge Function request with the public JWT but without the server-only ingress header returns HTTP 401; with the correct ingress header it passes authentication and reaches action dispatch.

Production test transactions were rolled back; they did not leave demo bookings in live business data. The Next.js customer pages and booking form are not yet enabled or deployed.

## 12. Required next phase

Before calling the feature operationally complete:
1. implement the customer portal page and QR link handling;
2. integrate the booking form with the new booking API;
3. build the admin Smart Booking workspace;
4. implement item/variant/quantity amendment with server-side price re-resolution;
5. implement atomic walk-in checkout from Smart Booking, revalidating stock and creating rental/sale rows in their existing domains;
6. add integration/browser tests for the full website → admin → walk-in flow;
7. enable the public booking UI only after those steps are verified.


### Production migration set (2026-11-09)

- `20261108232019_akasha_smart_booking_backend_foundation`
- `20261108233420_akasha_smart_booking_foreign_key_indexes`
- `20261108234755_akasha_smart_booking_backend_hardening`
- `20261108235645_akasha_smart_booking_availability_projection`
- `20261108235735_akasha_smart_booking_availability_interval_fix`
- `20261109000036_akasha_smart_booking_schedule_date_forecast_fix`
- `20261109000135_akasha_smart_booking_availability_signal_accuracy`
- `20261109001056_akasha_smart_booking_admin_availability_read_model`
- `20261109001839_akasha_smart_booking_close_legacy_anon_rpc`
- `20261109001957_akasha_smart_booking_customer_portal_change_visibility`
- `20261109002456_akasha_smart_booking_protect_legacy_reservation_flow`
- `20261109002859_akasha_smart_booking_edge_ingress_auth`
- `20261109003132_akasha_smart_booking_legacy_capacity_projection`
