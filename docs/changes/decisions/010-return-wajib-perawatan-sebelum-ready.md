# ADR-010 — Setiap Pengembalian Wajib Melalui Perawatan Sebelum Ready

Status: SUPERSEDED IN POST-RENTAL MAINTENANCE RULE BY ADR-019
Tanggal: 2026-10-02
Superseded by: ADR-019 — Operational Workspace Backend Orchestration dan Readiness Parsial
Scope retained: ownership, maintenance verification, dan readiness gate tetap berlaku; aturan bahwa setiap inspection normal wajib membuat maintenance sudah superseded.

## Konteks

Rental selesai tidak cukup hanya dicatat sebagai pengembalian dan pemeriksaan. Setelah unit dipakai penyewa, unit harus melewati pekerjaan pasca-sewa sebelum boleh kembali ke status Siap Disewakan.

Temuan aktual pada unit SPT-001 menunjukkan celah: pemeriksaan sudah selesai dan temuan sudah tersimpan, tetapi tidak ada tugas Perawatan dan unit tetap inspection_pending.

## Keputusan

Alur kanonik setelah unit kembali adalah:

Selesaikan Sewa
→ Pengembalian
→ Pemeriksaan
→ Perawatan
→ Verifikasi Kesiapan
→ Inventaris: Siap Disewakan

Setiap unit yang menyelesaikan rental wajib masuk ke Perawatan setelah Pemeriksaan selesai.

### Aturan

1. Pemeriksaan selesai selalu membuat satu tugas Perawatan untuk unit tersebut.
2. Hasil Normal tetap membuat Perawatan standar, default berupa Pembersihan setelah penyewaan.
3. Hasil dengan temuan menentukan jenis pekerjaan secara modular:
   - kerusakan / keputusan perlu perbaikan → Perbaikan;
   - kotor / perlu pembersihan → Pembersihan;
   - temuan lain yang belum dapat langsung dikategorikan → Tindak Lanjut Pemeriksaan.
4. Tugas Perawatan dibuat dalam transaksi yang sama dengan penyelesaian Pemeriksaan. Tidak boleh ada keadaan "Pemeriksaan selesai tetapi Perawatan belum dibuat".
5. Saat handoff terjadi, status unit berubah dari inspection_pending menjadi maintenance.
6. Perawatan selesai tidak membuat unit otomatis siap. Unit harus melewati Verifikasi Kesiapan.
7. Verifikasi lulus mengubah status Inventaris menjadi ready / Siap Disewakan. Verifikasi gagal mempertahankan unit pada maintenance.
8. Hanya ada satu tugas Perawatan otomatis untuk satu pemeriksaan return. Retry tidak membuat tugas ganda.
9. Perawatan manual tetap tersedia sebagai jalur modular untuk kebutuhan di luar alur return.
10. Toleransi dan denda tetap menjadi bagian dari kebenaran Rental dan tidak mengubah ownership Pengembalian, Pemeriksaan, atau Perawatan.
11. ADR-008 tentang registrasi unit baru tetap berlaku. Aturan ini hanya mengubah jalur pasca-rental, bukan penerimaan barang baru.

## Ownership

- Penyewaan: jadwal, toleransi, serah-terima, dan fakta penggunaan.
- Pengembalian: fakta unit benar-benar diterima kembali.
- Pemeriksaan: hasil kondisi dan temuan.
- Perawatan: pekerjaan yang harus dilakukan setelah pemeriksaan.
- Inventaris: status fisik/operasional dan status Siap Disewakan setelah verifikasi.

## UX

Bahasa antarmuka harus memakai istilah yang mudah dipahami pelaku usaha:

- Selesaikan Sewa
- Terima Pengembalian
- Periksa Kondisi
- Lanjutkan Perawatan
- Mulai Perawatan
- Selesaikan Perawatan
- Verifikasi Kesiapan
- Siap Disewakan

Hindari istilah teknis seperti RPC, command, inspection handoff, reconciliation, atau state machine pada UI operasional.

## Acceptance

- UAT-RET-MNT-001: rental aktif menyediakan aksi Selesaikan Sewa.
- UAT-RET-MNT-002: pengembalian menampilkan unit yang sudah kembali dan riwayat pengembalian.
- UAT-RET-MNT-003: pemeriksaan selesai selalu membuat tugas Perawatan.
- UAT-RET-MNT-004: pemeriksaan normal membuat Perawatan standar.
- UAT-RET-MNT-005: temuan kerusakan membuat Perawatan jenis Perbaikan.
- UAT-RET-MNT-006: temuan kotor membuat Perawatan jenis Pembersihan.
- UAT-RET-MNT-007: tidak ada tugas Perawatan ganda untuk pemeriksaan yang sama.
- UAT-RET-MNT-008: Perawatan selesai belum membuat unit ready.
- UAT-RET-MNT-009: Verifikasi Kesiapan lulus membuat unit Siap Disewakan.
- UAT-RET-MNT-010: unit gagal verifikasi tetap berada di Perawatan.
- UAT-RET-MNT-011: alur toleransi dan denda tetap mempertahankan jadwal resmi, deadline toleransi, dan fakta pengembalian.
