# ADR-015 — Immutability Rental History & Orphan Unit Reconciliation

**Status:** Accepted  
**Tanggal:** 2026-10-03  
**Scope:** Penyewaan + Inventaris + Pengembalian

## Context

Rekonsiliasi production-readiness menemukan dua unit fisik berstatus `rented` tanpa lagi memiliki rental aktif maupun assignment:

- `Car-40L-001`
- `CARR-E40-BLK-001`

Keduanya memiliki fakta terakhir `rental_pickup` dari rental historis yang sudah tidak ada di tabel `penyewaan`. Tidak ditemukan assignment aktif, return detail, inspection pending, atau maintenance terbuka.

Kondisi ini membuat stock fisik terlihat sedang disewa walaupun possession fact sudah tidak dapat ditelusuri ke rental yang ada.

## Decision

1. Histori rental dan assignment unit tidak boleh dihapus secara fisik.
2. Database memblokir `DELETE` pada `penyewaan` dan `penetapan_unit` melalui trigger invariant.
3. Penghapusan/cleanup QA tidak boleh menggunakan delete terhadap fakta historis. Cleanup harus memakai mekanisme yang mempertahankan audit dan lifecycle.
4. Orphaned rented unit hanya boleh direkonsiliasi melalui repair eksplisit jika seluruh kondisi berikut terverifikasi:
   - status unit saat ini `rented`;
   - fakta terakhir adalah `rental_pickup` dari `penyewaan`;
   - source rental sudah tidak ada;
   - tidak ada assignment;
   - tidak ada return detail;
   - tidak ada inspection pending;
   - tidak ada maintenance terbuka.
5. Repair orphan tidak membuat return palsu. Unit dikembalikan ke `ready` melalui fakta rekonsiliasi Inventaris, dengan `riwayat_unit`, `audit_log`, dan `outbox_event` baru.
6. Repair harus fail-closed: jumlah candidate harus tepat sesuai evidence yang sudah diverifikasi.

## Applied Change

Migration:
`20261003015225_rental_unit_orphan_reconciliation`

Migration memperbaiki tepat dua unit yang sudah diverifikasi dan memasang delete guards untuk mencegah kelas orphan yang sama terulang.

## Verification

Setelah migration:

- `Car-40L-001` → `ready`
- `CARR-E40-BLK-001` → `ready`
- distribusi unit: `ready=29`, `rented=8`
- `RNT-2026-025` tetap `active` dengan 8 unit assigned
- orphan detector → `0`
- history reconciliation tercatat untuk kedua unit
- audit reconciliation tercatat untuk kedua unit
- outbox reconciliation tercatat untuk kedua unit
- percobaan delete assignment dan rental historis ditolak oleh guard `HISTORY_IMMUTABLE`

## Consequence

System sekarang mempertahankan rental/assignment history sebagai fakta audit yang tidak boleh dihapus. Operasi QA yang sebelumnya menghapus rental/assignment secara langsung harus diganti dengan cleanup yang aman dan dapat direkonsiliasi.

Repair ini tidak mengklaim bahwa unit pernah menjalani return; fakta yang dicatat adalah rekonsiliasi orphan dari state `rented` menjadi `ready`.
