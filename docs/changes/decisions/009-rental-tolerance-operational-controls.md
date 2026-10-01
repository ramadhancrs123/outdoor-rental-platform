# ADR-009 — Rental Tolerance Operational Controls

Status: **ACCEPTED**

Tanggal: 2026-10-01

## Keputusan

Sistem Rental Outdoor mengunci kontrol operasional waktu pengembalian berikut:

1. Rental mempertahankan tiga fakta waktu:
   - jadwal_kembali = jadwal resmi;
   - tolerance_deadline = batas toleransi efektif;
   - waktu aktual pengembalian = fakta penerimaan nyata.

2. usaha.default_tolerance_hours adalah master default untuk penyewaan baru.
   Perubahan master tidak mengubah rental yang sudah dibuat.

3. Admin dapat memberi tambahan toleransi secara eksplisit melalui command bisnis.
   Tambahan toleransi:
   - tidak mengubah jadwal_kembali;
   - menambah tolerance_deadline;
   - wajib memiliki alasan;
   - wajib tercatat bersama admin, waktu, deadline lama, dan deadline baru;
   - tenant-scoped dan idempotent.

4. Countdown operasional dihitung dari waktu sekarang terhadap deadline canonical, bukan disimpan sebagai angka countdown.

5. Panel Admin menampilkan timing setidaknya di:
   - daftar Penyewaan;
   - daftar Pengembalian;
   - detail Penyewaan;
   - detail Pengembalian bila tersedia.

6. Pemberitahuan fase awal untuk rental timing:
   - saat jadwal kembali telah lewat;
   - 30 menit sebelum tolerance_deadline;
   - saat/ setelah tolerance_deadline.
   Notifikasi dibuat oleh worker database dan dikirim melalui outbox → notification consumer. Repeated worker execution harus idempotent.

7. Fitur denda keterlambatan bersifat opsional per Usaha:
   - default nonaktif;
   - tarif configurable per jam;
   - mulai dihitung setelah tolerance_deadline;
   - jumlah jam yang dikenai biaya adalah pembulatan ke atas elapsed late duration;
   - hasilnya adalah financial assessment/charge, bukan bukti pembayaran dan bukan payment otomatis;
   - Finance tetap owner atas fakta uang yang benar-benar diterima/dicatat.

8. Excel export untuk late fee/tolerance ditunda dan tidak menjadi bagian implementasi ADR ini.

## Rumus Denda

Jika fitur denda aktif:

    late_duration = max(0, effective_return_time - tolerance_deadline)
    billable_hours = ceil(late_duration / 1 jam)
    late_fee = billable_hours × late_fee_per_hour

Untuk rental yang belum selesai, effective_return_time untuk tampilan disebut denda berjalan dan menggunakan waktu sekarang. Setelah rental memiliki actual_return_completed_at, nilai tersebut menjadi waktu aktual untuk perhitungan final operasional.

## Batas Ownership

    Penyewaan = rental schedule + tolerance policy application
    Pengembalian = actual return
    Pemberitahuan = attention/delivery
    Keuangan = money truth
    Laporan = derived report

Notifikasi tidak mengubah source business truth.

## Acceptance

- UAT-TOL-001: master tolerance dapat diubah admin dan berlaku untuk rental baru.
- UAT-TOL-002: perubahan master tidak mengubah rental lama.
- UAT-TOL-003: admin dapat menambah tolerance dengan preset/custom duration dan alasan wajib.
- UAT-TOL-004: penambahan tolerance tidak mengubah jadwal_kembali.
- UAT-TOL-005: riwayat tolerance menampilkan old/new deadline, alasan, admin, timestamp.
- UAT-TOL-006: countdown konsisten pada list/detail/mobile.
- UAT-TOL-007: notifikasi due dibuat satu kali per schedule.
- UAT-TOL-008: notifikasi 30 menit sebelum tolerance dibuat satu kali per deadline.
- UAT-TOL-009: notifikasi tolerance expired dibuat satu kali per deadline.
- UAT-TOL-010: Realtime memperbarui inbox/badge admin bila notification record baru masuk.
- UAT-TOL-011: denda disabled menghasilkan Rp0.
- UAT-TOL-012: denda enabled menghasilkan kalkulasi per jam setelah tolerance expired dan tidak membuat payment otomatis.
- UAT-TOL-013: retry command tolerance tidak menggandakan perubahan/history.
- UAT-TOL-014: tenant isolation dan authorization tetap enforced.
