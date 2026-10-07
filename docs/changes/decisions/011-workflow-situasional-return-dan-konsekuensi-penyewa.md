# ADR-011 — Workflow Situasional Return dan Konsekuensi Penyewa

Status: ACCEPTED
Tanggal: 2026-10-02

## Keputusan

Sistem mengikuti tindakan nyata admin, bukan waktu sebagai pemicu perubahan state.

Alur operasional:
Sewa berjalan
→ Selesaikan Sewa
→ pilih unit yang benar-benar diterima
→ Terima Pengembalian
→ Periksa Kondisi
→ Pemeriksaan
→ Perawatan
→ Verifikasi Kesiapan
→ Inventaris: Siap Disewakan

Waktu hanya menjadi konteks:
- jadwal kembali;
- batas toleransi;
- countdown;
- notifikasi.

Waktu tidak boleh membuat actual return, menyelesaikan rental, atau membuat unit ready secara otomatis.

Toleransi:
- tidak mengubah jadwal resmi;
- tidak mengubah actual return;
- tidak memperpanjang rental secara otomatis;
- dapat diperpanjang admin dengan alasan dan histori.

Denda:
- tetap merupakan financial assessment;
- hanya difinalkan ketika actual full return benar-benar terjadi;
- nilai denda yang ditemukan dari kebijakan disimpan sebagai Potensi Tanggungan Penyewa dengan status Menunggu Tinjauan;
- tidak menjadi payment, receivable, atau transaksi keuangan otomatis.

Kerusakan, kehilangan, dan komponen hilang:
- fakta kondisi tetap berasal dari Pemeriksaan;
- bila memiliki nominal potensi biaya atau membutuhkan peninjauan biaya, sistem membuat Potensi Tanggungan Penyewa;
- catatan selalu terhubung ke penyewa, rental, unit, dan sumber temuan;
- status awal Menunggu Tinjauan;
- Finance menentukan apakah konsekuensi tersebut disetujui atau ditolak;
- approval tidak otomatis membuat pembayaran.

## UX

Operator harus dapat menjalankan alur tanpa menunggu timer.

Pada rental aktif:
- tombol utama: Selesaikan Sewa.

Pada Pengembalian:
- admin memilih unit yang benar-benar diterima;
- setelah berhasil, unit langsung ditawarkan untuk Periksa Kondisi.

Pada keterlambatan:
- sistem menjelaskan apakah masih dalam toleransi atau sudah melewati toleransi;
- tombol pengembalian tetap merupakan tindakan nyata admin.

Pada konsekuensi biaya:
- tampilkan Potensi Tanggungan Penyewa;
- tampilkan nominal kandidat bila tersedia;
- tampilkan Menunggu Tinjauan bila belum diputuskan;
- jangan menyebutnya sudah menjadi tagihan atau pembayaran.

## Acceptance

- UAT-SIT-001: rental aktif selalu memiliki aksi Selesaikan Sewa.
- UAT-SIT-002: waktu lewat tidak membuat actual return otomatis.
- UAT-SIT-003: tolerance expiry tidak membuat rental selesai otomatis.
- UAT-SIT-004: actual return hanya tercatat dari tindakan Terima Pengembalian.
- UAT-SIT-005: setelah return berhasil, unit langsung dapat dibuka ke Periksa Kondisi.
- UAT-SIT-006: full return baru membuat rental completed jika seluruh unit benar-benar diterima.
- UAT-SIT-007: final late-fee assessment hanya dibuat setelah full return nyata.
- UAT-SIT-008: late-fee assessment tidak membuat payment otomatis.
- UAT-SIT-009: damage/loss/missing component dapat membuat Potensi Tanggungan Penyewa.
- UAT-SIT-010: potensi tanggungan tidak otomatis menjadi payment atau receivable.
- UAT-SIT-011: retry tidak menggandakan consequence review.
- UAT-SIT-012: tenant isolation tetap berlaku.
- UAT-SIT-013: return, inspection, maintenance, dan consequence review tetap dapat ditelusuri.
