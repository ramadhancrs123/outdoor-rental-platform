# ARD-002 — AKASHA RESERVASI (Unified Smart Booking)

> **Status:** Unified Reservasi Center, Smart Booking aggregate, customer portal, and calendar implementation are in source. Production readiness remains subject to migration application, real transactional QA, and Vercel Preview/production verification.
> **Scope:** One Reservasi feature across website and admin intake, booking-scoped customer access, calendar/read-only availability, customer changes, and operational handoff.
> **Related decisions:** `ADR-004 — Reservasi Tidak Mengunci Unit`, `ADR-009 — Website Self-Service Booking (Draft Reservasi)`.  
> **Business boundary:** Rental Outdoor / Akasha Outdoor only. No cross-tenant sharing.

---

## 1. Purpose

AKASHA RESERVASI adalah satu fitur dan satu workspace untuk seluruh reservasi Akasha Outdoor, baik yang masuk dari website maupun yang dicatat admin dari Permintaan Sewa. "Smart Booking" adalah nama teknis aggregate dan workflow yang menjalankan fitur Reservasi, bukan modul atau jenis reservasi kedua.

Data admin menggunakan satu aggregate kanonis `app_private.akasha_smart_booking`. Untuk reservasi rental yang terhubung ke proses lama, `public.reservasi` dipertahankan sebagai record kompatibilitas yang ditautkan melalui `reservasi_id`; record itu bukan reservasi kedua dan tidak boleh dibuat sebagai entri kalender atau antrean terpisah. Booking pembelian saja tidak memerlukan record `public.reservasi`.

Reservasi mencatat kesepakatan dan jadwal customer. Pencatatan, peninjauan, atau tampilan kalender tidak dengan sendirinya menjadi penguncian kapasitas, alokasi unit fisik, transaksi rental/penjualan, pembayaran, atau pergerakan stok.

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
- Website rental submission creates a linked request, a compatibility row in `public.reservasi` with `status = draft`, and exactly one `app_private.akasha_smart_booking` aggregate.
- Admin creation from Permintaan Sewa calls `public.admin_create_akasha_smart_booking_from_request`, which creates the compatibility row and Smart Booking aggregate in one transaction.
- `stock_lock_status = not_locked`; the compatibility row is never exposed as a second admin reservation.
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
- customer enters the access code shown on the booking receipt, or opens a private link;
- server exchanges the code/link for a short-lived session scoped to that booking;
- session cannot access other bookings or tenant data.

The private link carries its token in the URL fragment; the server exchanges it for the same scoped session. This is not customer account registration; it is a temporary access mechanism for one booking.

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
- `fulfilled`: the admin's atomic operational checkout converted the request into actual rental and/or sale transactions. The booking is marked fulfilled only after the existing trusted transaction command succeeds.

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
- item/variant/quantity and same-category alternative approvals use the dedicated item-editor command, which re-resolves catalog prices/promotions and rebuilds only the Smart Booking line snapshots;
- generic status mutation cannot apply item changes.

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
- routes booking creation, access-code login, private-link login, portal reads, availability reads, customer changes, and logout;
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

## 10. Historical non-goals of the backend-foundation phase (2026-11-09)

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

At the backend-foundation checkpoint on 2026-11-09, production test transactions were rolled back and left no demo bookings in live business data. At that checkpoint the Next.js customer pages and booking form had not yet been enabled or deployed; subsequent implementation status is reconciled in Section 13.

## 12. Historical next-phase checklist (backend baseline, 2026-11-09; reconciled in Section 13)

The following were the remaining tasks at the 2026-11-09 backend-foundation checkpoint (current implementation status is reconciled in Section 13):
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


---

## 13. Customer-facing flow and implementation reconciliation (2026-11-10)

This section is the current product and implementation contract. It supersedes the earlier phase notes in Sections 10–12 where those notes say that the portal UI, item amendment, walk-in handoff, operational conversion, or customer receipt remain unimplemented.

### 13.1 Public customer journey

The public customer journey has one product-entry surface:

    Public CTA / Katalog
           ↓
    /katalog — AKASHA SMART BOOKING
           ↓
    Select a product
           ↓
    Product dialog: rental variant / purchase option + quantity + price
           ↓
    Explicit "Konfirmasi pilihan barang"
           ↓
    Temporary cart
           ↓
    Final booking review dialog
      - editable lines and quantities
      - pickup / return dates when rental exists
      - customer name and WhatsApp
      - optional note
           ↓
    POST /api/akasha-smart-booking/bookings
           ↓
    /booking/sukses
      - booking reference
      - customer access code
      - private portal link
      - QR code to the private portal
      - downloadable PNG and PDF booking receipt
           ↓
    Customer portal

UX rules:
- /katalog is the single public product selection and booking-entry page.
- Legacy /booking and /booking/checkout URLs redirect to /katalog; they do not render another product form.
- Product choice is not added to the cart until the customer confirms the selection dialog.
- The selection dialog shows the target option, active catalog price, applicable promotion display, and quantity before confirmation.
- The final review is a dialog on the catalog page, not a second booking route. Customers can change quantities or remove lines before submission.
- Rental dates are required only when at least one rental line exists. Purchase-only booking does not ask for rental dates.
- For rental lines, the final review computes a date-based estimate by multiplying quantity × active unit price × tariff periods. Purchase lines are counted once.
- Date-only estimates assume pickup and return happen at the same local clock time. Periods use the same ceiling rule as Admin Walk-in and have a minimum of one period. The estimate is indicative, not an invoice.
- The customer-facing daily-period marketing label is "2 hari 1 malam"; the stored tariff duration and price contract are unchanged.
- The customer enters a name and WhatsApp number. Note is optional.
- The successful request navigates directly to /booking/sukses; it does not return the customer to /booking.
- The receipt is a booking/access proof, not a paid invoice or proof of a completed rental/sale transaction.
- The PNG/PDF receipt is generated client-side from the successful response and includes the reference, selected lines, customer contact, available dates, date-derived stay duration and estimated amount, access code, private portal link, and QR.

Booking constraints exposed in the UI must continue to match the server contract: 1–10 distinct lines and 1–20 units per line. Browser prices are a display snapshot only; the server resolves trusted catalog prices and promotions again.

### 13.2 Customer identity and loyalty linkage

The current rental request path calls public.command_create_website_booking. That existing command:
- normalizes the submitted phone number to digits;
- searches public.penyewa within the resolved usaha_id by nomor_telepon_normalized;
- reuses the found penyewa_id;
- creates a renter only when no renter with that normalized phone exists;
- links the request, draft reservation, and Smart Booking aggregate to that renter.

Therefore, an existing renter with the same name and normalized WhatsApp number is reused; a second renter row is not created for that rental booking. The lookup key is the normalized phone number, not a strict two-field (name, phone) equality check. The submitted name remains a booking/customer snapshot. A different name entered with an already-registered phone will still resolve to the existing renter record; operators should correct the renter master data through the existing renter workflow rather than expecting booking submission to silently rename that record.

Important boundary:
- Purchase-only Smart Booking does not call the legacy rental request command and currently has no penyewa_id link. The customer name/phone are stored on the booking aggregate for portal access and follow-up, but a purchase-only booking does not create or attach a renter record. Do not present purchase-only booking as contributing to rental loyalty history until a separate, explicitly approved customer-linkage contract exists.
- For rental booking, the final confirmation UI tells customers to use the WhatsApp number already registered with Akasha so the existing renter history can be reused.
- The UI must not create renter records directly and must not perform client-side name/phone matching. Tenant-scoped matching remains server-authoritative.

### 13.3 Customer portal contract

The customer portal is booking-scoped and does not register a permanent customer account. It must keep the following information actionable and readable:
- booking reference, current workflow status, last revision, requested pickup/return dates, date-derived stay duration, and current estimated cost;
- requested rental/purchase lines, quantity, promotions, rental tariff-period count, and the breakdown behind the estimate;
- a proposed duration and cost preview when the customer edits the schedule or proposes a new item set;
- current availability signal, exact-variant and cross-variant readiness, potential returns, and check timestamp, without exposing physical unit identifiers;
- customer actions for same-category alternatives, item/variant/quantity changes, schedule changes, and cancellation where the line/status supports that action;
- pending and resolved request history plus a customer-visible activity timeline;
- after conversion, real transaction tracking for checkout, rental and/or sale numbers, transaction status, actual handover/return timestamps, rental item preparation/assignment progress, tolerance deadline, sale lines and payment state.

The portal refreshes booking progress periodically while visible and preserves the latest verified state during brief network failures. A date-based estimate assumes matching pickup/return clock times because the public form accepts dates only; pending schedule changes update only the preview until an administrator approves them. The customer must be told that Admin Walk-in recalculates tariff periods from actual handover timestamps. The portal must not imply that projected stock is guaranteed or that a pending customer change has already been applied.

### 13.4 Admin operational handoff

Admin mengelola satu Reservasi Center pada route kanonis `/reservasi`. Tampilan default adalah kalender bulanan dengan agenda tanggal terpilih; tampilan Daftar dan tindak lanjut berada pada workspace yang sama. Tidak ada menu atau daftar admin terpisah bernama Booking Online.

Satu Reservasi Center menyediakan detail customer, jadwal, snapshot barang dan harga, proyeksi ketersediaan, review perubahan customer, transisi status, rotasi akses portal, komunikasi customer, dan handoff ke Walk-in. Sumber website serta reservasi yang dibuat admin dari Permintaan Sewa diproyeksikan ke aggregate yang sama.

Operational conversion is allowed only when:
- workflow status is ready_for_checkout;
- there are no pending customer change requests;
- the checkout request matches the currently approved booking line snapshot;
- renter identity and approved rental dates match when rental lines exist;
- a valid operational receiving account is supplied for sale lines;
- all trusted operational tariff, promotion, stock, payment, and transaction validations succeed.

Detail Reservasi membedakan snapshot harga dasar dari estimasi berdasarkan rentang tanggal. Detail menyelesaikan basis durasi tarif asli, menghitung jumlah periode dan estimasi subtotal. Estimasi date-only menggunakan aturan ceiling yang sama dengan asumsi jam pengambilan dan pengembalian setara.

Kalender memakai `business_timezone` dari Usaha. Setiap tanggal menunjukkan jumlah reservasi yang beririsan dengan tanggal tersebut serta indikator pengambilan, pengembalian, dan periode rental berjalan. Pemilihan tanggal menampilkan agenda customer, status, ringkasan item, jumlah permintaan perubahan yang pending, WhatsApp, dan akses ke detail. Rentang yang melintasi bulan tetap terlihat; status cancelled, expired, dan fulfilled tidak dihitung sebagai jadwal aktif.

The conversion command is atomic and idempotent. Admin Walk-in calculates tariff periods again from the actual pickup and return timestamps, validates stock/pricing/payment through the existing rental/retail commands, links the resulting transaction identities, and only then marks the Smart Booking as fulfilled. The operational calculation is authoritative if it differs from the date-only estimate. This does not introduce a separate inventory lock or physical-unit allocation model.

### 13.5 Required acceptance scenarios

| Scenario | Expected behavior | Boundary / evidence |
| --- | --- | --- |
| Mixed rental + purchase | One public cart and one Smart Booking request preserve separate rental and sale line kinds. | Booking aggregate snapshots remain separate from operational detail rows. |
| Existing renter, same WhatsApp | Rental request reuses the tenant-scoped renter ID; no duplicate renter row is created. | Legacy command lookup by normalized phone number. |
| New WhatsApp for rental | The legacy request command creates one renter and links the request/reservation/booking. | Database transaction and tenant scope. |
| Purchase-only | Request is accepted without rental dates; no renter linkage is currently created. | Do not count it as rental loyalty activity. |
| Product choice | Selection dialog requires explicit confirmation before adding variants/options and quantities to the temporary cart. | Browser test on mobile and desktop. |
| Final review edits | Customer can update quantity/remove lines and edit contact/date data before submission. | Submitted API payload reflects final review state. |
| Duplicate/uncertain submit | Repeated request with the same idempotency key and payload does not create a second booking. Different payload with the same key is rejected. | Existing API/DB idempotency contract. |
| Customer changes | Portal request remains pending until admin review; item approval re-resolves catalog truth and changes only the booking snapshot. | Expected-revision and dedicated apply command. |
| Walk-in conversion | Admin opens Walk-in from a ready booking; operational command revalidates current tariff/promo/stock and creates rental and/or sale transaction(s). | Atomic conversion migration and service tests. |
| Post-conversion tracking | Portal shows actual rental/sale transaction identifiers and sanitized operational progress. | Customer tracking projection migration. |
| Booking receipt | Success page shows available access credentials and QR, and can export PNG/PDF on the customer device. | Browser export test; no secret in query string. |

### 13.6 Verification and production boundary

The implementation is present in the local main checkout and is expected to be validated with:
- web TypeScript and lint checks;
- web Smart Booking contract tests;
- admin Smart Booking service and portal-link tests;
- production build;
- Playwright checks for catalog selection confirmation, cart editing, final review, success receipt export, customer portal, and mobile viewport overflow;
- live integration checks for actual renter reuse, customer portal authentication, admin review, and a controlled operational conversion.

A successful local build or browser mock does not prove that a real customer booking was written to production, that the private credential environment is configured on every deployment target, or that a real rental/sale conversion succeeded. Those require an authorized live test and must be reported separately. No inventory lock is created at customer submission.


## 14. Unified Reservasi Center dan kalender (2026-11-10)

Keputusan ini mengunci model produk tunggal:
- Nama fitur dan navigasi admin adalah **Reservasi**. "Smart Booking" hanya istilah teknis untuk aggregate, workflow, dan kanal API.
- Route kanonis admin adalah `/reservasi`. Menu terpisah "Booking Online" dihapus. Route lama `/akasha-smart-booking` dipertahankan sebagai compatibility alias.
- Halaman daftar/detail Reservasi lama tidak lagi menjadi workspace tersendiri. Daftar, detail, kalender, customer, perubahan, proyeksi ketersediaan, akses portal, dan handoff transaksi berada pada satu Reservasi Center.
- Website dan admin-created request memakai satu aggregate `app_private.akasha_smart_booking`. Admin-created request menggunakan `public.admin_create_akasha_smart_booking_from_request` untuk membuat linked `public.reservasi` compatibility record dan Smart Booking aggregate dalam satu transaksi.
- Calendar read model `public.admin_get_akasha_smart_booking_calendar` bersifat read-only, tenant-scoped, dan memakai membership guard eksplisit termasuk `revoked_at IS NULL`. Read model hanya membaca Smart Booking aggregate sehingga linked `public.reservasi` tidak dihitung dua kali.
- Kalender bulanan adalah tampilan awal; tanggal yang memiliki jadwal menampilkan jumlah reservasi dan sinyal pengambilan, pengembalian, serta rentang rental. Agenda tanggal terpilih membuka customer, status, ringkasan item, WhatsApp, dan detail Reservasi.
- Rentang bulan dibaca menurut `business_timezone`, termasuk jadwal lintas bulan. Pembelian-only tanpa tanggal rental tetap tersedia pada Daftar, bukan dipaksakan ke kalender rental.
- Pemeriksaan ketersediaan dan pengeditan kesepakatan berjalan dari detail Reservasi. Operasi fisik unit, readiness, transaksi, pembayaran, dan stock movement tetap dieksekusi melalui command-domain Inventaris/Walk-in/Keuangan yang sudah ada.

Tidak ada tabel reservasi baru, tidak ada pemindahan canonical data, dan tidak ada penguncian stok yang muncul hanya karena kalender dibuka.


### 14.1 One-click confirmation for daily operations

- Admin hanya memiliki satu tindakan konfirmasi pada alur normal. Tombol **Konfirmasi** langsung mengubah reservasi ke `ready_for_checkout` / **Siap diproses**; tidak ada langkah admin terpisah untuk mulai tinjau, sedang ditinjau, atau sudah ditinjau.
- Status perantara lama tetap dapat dibaca untuk menjaga kompatibilitas data, tetapi tidak lagi tersedia sebagai tindakan yang dapat dipilih admin.
- Konfirmasi tidak dapat dilakukan selama masih ada permintaan perubahan pelanggan yang belum diselesaikan, saat reservasi menunggu informasi pelanggan, atau saat ada permintaan pembatalan.
- Ketersediaan dan stok fisik tetap diverifikasi pada saat transaksi dibuat; konfirmasi bukan alokasi unit atau jaminan stok.
