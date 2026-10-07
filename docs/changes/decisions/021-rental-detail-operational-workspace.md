# ADR-021 — Detail Penyewaan sebagai Rental Operational Workspace

Status: ACCEPTED
Tanggal: 2026-10-05
Scope: Fase 3 — information architecture / operational UX
Supersedes: pilihan navigasi Page 2 yang mensyaratkan halaman Pengembalian sebagai workspace utama.

## Keputusan

Panel Admin menggunakan `Detail Penyewaan` (`/penyewaan/:id`) sebagai pusat operational workspace untuk lifecycle rental.

Page 1 tetap `Buat Rental`. Page 2 secara mental-model tetap `Selesaikan Sewa`, tetapi secara route dan implementasi menggunakan `Detail Penyewaan` yang sama agar konteks transaksi tidak terpecah.

Pengembalian, Pemeriksaan, Perawatan, Inventaris, dan Keuangan tidak digabung menjadi satu domain. Ownership canonical tetap:

- Penyewaan: rental, schedule, assignment, handover;
- Pengembalian: actual return;
- Pemeriksaan: condition/finding;
- Perawatan: maintenance work;
- Inventaris: physical readiness;
- Keuangan: money truth.

## Golden Path

```text
Buat Rental
↓
Detail Penyewaan / Rental Operational Workspace
↓
Rental Active
↓
Terima unit per unit
↓
Pilih kondisi eksplisit
↓
normal → readiness → READY
rusak/kotor/missing component → Perawatan
↓
verifikasi readiness bila diperlukan
```

`Pemeriksaan` tidak menjadi halaman wajib pada golden path. Canonical inspection tetap dibuat melalui operational command. `Perawatan` tetap mempunyai halaman/list mandiri untuk maintenance manual, queue, histori, dan tindakan lanjutan.

## Partial Return / Mixed Outcome

Readiness bersifat unit-scoped. Dalam satu rental, hasil yang sah dapat berupa:

```text
Unit A → return → inspection normal → READY
Unit B → return → inspection damage → Maintenance
Unit C → masih bersama penyewa
```

Unit A tidak boleh tertahan hanya karena Unit B membutuhkan Perawatan. Rental dapat tetap `return_in_progress` selama Unit C belum kembali.

## Navigation

Primary navigation tidak lagi menempatkan `Pengembalian` sebagai menu utama. Route `/pengembalian` tetap dipertahankan untuk compatibility, deep-link, recovery, dan legacy flows yang belum dimigrasikan. Entry point normal dari dashboard/rental list diarahkan ke `/penyewaan/:id#rental-operational`.

`Perawatan` tetap berada sebagai tool modular terpisah untuk pekerjaan maintenance yang memang berdiri sendiri.

## Guardrails

- Jangan memindahkan ownership domain ke Detail Penyewaan.
- Jangan menganggap kondisi normal tanpa pilihan operator.
- Jangan mengubah return menjadi READY tanpa server readiness decision.
- Jangan membuat semua inspection otomatis menjadi maintenance.
- Jangan menunggu semua unit rental sebelum unit yang sudah returned dapat READY.
- Jangan menghapus route/module Pengembalian, Pemeriksaan, atau Perawatan selama migration compatibility belum dibuktikan.
- Tidak ada mutation generic status patch.

## Acceptance

- Detail Penyewaan menyediakan operational workspace saat rental actionable.
- Operator dapat memilih kondisi per unit.
- Normal menjadi READY tanpa menunggu unit lain.
- Rusak/kotor/missing component masuk Perawatan.
- Mixed outcome per unit dapat tampil bersamaan.
- Primary navigation tidak lagi memaksa operator membuka Pengembalian.
- Existing Return route tetap dapat digunakan sebagai compatibility path.
