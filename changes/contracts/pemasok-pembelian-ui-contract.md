# Pemasok + Pembelian — UI/UX Contract Foundation

## Scope

Layer ini adalah **functional contract foundation**, bukan final visual design.

UI/UX designer bebas mengubah:
- layout;
- spacing;
- typography;
- color;
- component styling;
- responsive composition;
- interaction presentation;

selama business semantics dan state contract di bawah tetap dipertahankan.

## Canonical module boundaries

### Pemasok
Owner:
- identity pemasok;
- kontak;
- alamat;
- catatan;
- status active/inactive;
- histori hubungan dengan pembelian.

Pemasok tidak membuat:
- pembelian;
- payment;
- receiving;
- unit inventaris;
- availability.

### Pembelian
Owner:
- nomor pembelian;
- tanggal pembelian;
- supplier relation;
- purchase line;
- quantity;
- purchase price;
- subtotal;
- total;
- currency;
- catatan;
- status yang berasal dari database.

Pembelian tidak otomatis berarti:
- receiving;
- physical unit;
- unit ready;
- payment.

Receiving adalah domain/fakta terpisah.

## Route contract

`/pemasok`
→ supplier list/search.

`/pemasok/create`
→ create supplier.

`/pemasok/:id`
→ supplier detail + purchase history.

`/pemasok/:id/edit`
→ supplier metadata update.

`/pembelian`
→ purchase list/search/filter.

`/pembelian/create`
→ create purchase draft.

`/pembelian/:id`
→ purchase detail + line facts.

`/pembelian/:id/edit`
→ update purchase draft only.

No route exists for purchase finalization/cancellation because final purchase status semantics are not locked by the current source of truth.

## Supplier form contract

Required:
- nama.

Optional:
- nomor telepon;
- email;
- alamat;
- catatan.

States:
- idle;
- review;
- processing;
- success;
- error;
- unknown outcome;
- stale data.

Create command:
`create_supplier`

Update command:
`update_supplier`

Update requires `expected_updated_at`.

## Supplier lifecycle contract

Allowed UI action:
- active → inactive;
- inactive → active.

Inactive supplier:
- remains visible in history;
- does not become eligible for new purchase.

No auto-delete.

## Purchase form contract

Header:
- pemasok (optional according to baseline schema);
- nomor pembelian;
- tanggal pembelian;
- catatan.

Line:
- barang or varian;
- jumlah > 0;
- harga beli >= 0;
- deskripsi optional.

Client may show subtotal/total preview.

Server is authoritative for:
- subtotal;
- total;
- tenant;
- foreign keys;
- supplier active state;
- money validation;
- idempotency;
- concurrency.

## Purchase mutation contract

Create command:
`create_purchase`

Current frontend commits a **draft purchase**.

Update command:
`update_purchase_draft`

Update is allowed only while source row remains `draft`.

No frontend behavior may invent:
- ordered;
- committed;
- completed;
- cancelled;
- receiving;
- approval;
- invoice;
- tax;
- discount;
- shipping;
- supplier return.

Those require explicit source-of-truth decision/ADR.

## Error/state contract

### Processing
Do not send a second command.

### Unknown outcome
The first next action is:
`Periksa status`

Do not blind retry.

### Stale data
Existing server state wins.
Offer:
`Muat ulang`

Do not silently overwrite.

### Validation
Field-level feedback may be presented by the visual layer, but backend remains authoritative.

### Authorization / tenant denial
Do not expose cross-tenant hints.

## Responsive contract

Desktop supplier list:
- name;
- contact;
- status;
- purchase count;
- last purchase;
- action.

Mobile supplier card:
- name;
- contact;
- status;
- purchase summary;
- detail action.

Desktop purchase list:
- purchase number;
- date;
- supplier;
- line count;
- total;
- status;
- action.

Mobile purchase card:
- purchase number;
- supplier;
- total;
- line count;
- status;
- open action.

Purchase form:
- mobile-first;
- line item becomes card-like on small screens;
- desktop may use tabular composition.

## Designer freedom

Designer may replace current primitive structure with the project's selected design system.

Do not change:
- terminology;
- field ownership;
- tenant boundary;
- command semantics;
- server-authoritative totals;
- error state meanings;
- draft-only editing rule;
- procurement/inventory/finance/receiving separation.

## Current verified backend contract

Trusted commands and public authenticated RPC wrappers are deployed in Supabase.

Frontend is expected to call:
- create_supplier
- update_supplier
- set_supplier_status
- create_purchase
- update_purchase_draft
- command_reconcile_procurement_mutation

The direct browser table-mutation path remains denied.

## Acceptance anchors

Supplier:
- create;
- search;
- detail;
- active/inactive;
- purchase history;
- tenant isolation;
- RLS;
- audit.

Purchase:
- header;
- supplier relation;
- purchase date;
- status;
- line items;
- quantity;
- unit price;
- subtotal;
- total;
- currency;
- notes;
- audit.

Reliability:
- idempotency;
- concurrency;
- stale handling;
- unknown outcome;
- transaction safety.

Source gap:
- final purchase status/finalization semantics remain unresolved and must not be invented.
