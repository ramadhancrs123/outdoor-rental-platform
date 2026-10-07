# Verification — Rental & Finance History Reset

**Date:** 2026-10-05
**Status:** VERIFIED
**Environment:** Supabase dummy project `nbirkybutpvtrqifaxlt`

## Scope

Members, usaha, financial accounts, catalog, and physical inventory were preserved.

Rental and Finance transactional history was removed, including dependent child records and rental/finance-specific technical traces.

## Cleanup Evidence

### Preserved

- Usaha: 1
- Akun admin: 1
- Membership usaha: 1
- Akun keuangan: 1
- Barang katalog: 2
- Varian barang: 5
- Tarif sewa: 6
- Unit inventaris: 12
- QR Unit: 12
- Inventory registration history: 12

All 12 inventory units are `ready`.

### Cleared

- Penyewaan: 0
- Detail penyewaan: 0
- Penetapan unit: 0
- Serah-terima: 0
- QR penyewaan: 0
- Pengembalian: 0
- Pemeriksaan: 0
- Temuan pemeriksaan: 0
- Perawatan: 0
- Evaluasi konsekuensi rental: 0
- Perpanjangan sewa: 0
- Riwayat toleransi rental: 0
- Pembayaran: 0
- Transaksi keuangan: 0
- Pergerakan akun keuangan: 0
- Pengeluaran: 0
- Transfer akun keuangan: 0
- Refund pembayaran: 0
- Saldo awal akun keuangan: 0
- Rental-derived unit history: 0
- Rental/finance notifications: 0

### Technical reset

Rental/finance idempotency records were cleared while inventory/catalog onboarding idempotency records were preserved.

Rental/finance outbox events were cleared while inventory registration and renter-created events were preserved.

Rental/finance audit rows were cleared while inventory/catalog audit rows were preserved.

Rental, payment, and finance counters were reset so the next verification starts with fresh numbering.

## Explicit Non-Scope

The existing master renter record was not deleted because the requested cleanup was rental/finance history, not master renter data.

No catalog, inventory unit, QR Unit, business, admin account, membership, or financial account was deleted.

## Production

No production deployment, promotion, commit, or push occurred as part of this cleanup.
