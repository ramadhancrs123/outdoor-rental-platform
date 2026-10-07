# Decision 013 — Pickup Operasional & Toleransi Per Rental

## Keputusan

Penyewaan langsung maupun rental dari reservasi boleh menjalani serah-terima kapan pun barang benar-benar siap diserahkan dan penyewa hadir. Jadwal mulai adalah jadwal resmi transaksi; actual_pickup_at adalah fakta waktu serah-terima.

Admin tidak perlu menunggu tepat pada jadwal mulai untuk menyerahkan barang dan juga dapat memproses serah-terima setelah jadwal mulai berlalu selama rental masih berada pada state persiapan dan seluruh unit yang diperlukan sudah ditetapkan.

Toleransi dapat disesuaikan pada level rental tertentu, termasuk sebelum pickup, dengan alasan wajib dan histori audit. Perubahan toleransi tidak mengubah jadwal_kembali.

## UX

Untuk rental sederhana satu barang satu unit, halaman detail menggunakan satu alur:
pilih unit → Serahkan Barang.

Untuk rental multi-unit atau paket, penetapan unit tetap dilakukan per target/komponen, lalu tersedia satu aksi serah-terima setelah seluruh kebutuhan unit terpenuhi.

## Boundary

- Penyewaan tetap menjadi owner pickup, active state, schedule, tolerance, dan transition ke Pengembalian.
- Inventaris tetap menjadi owner physical unit dan readiness.
- Pengembalian tetap menjadi owner penerimaan kembali.
- Finance tetap menjadi owner payment/financial consequence.
- Tolerance berbeda dari extension rental: schedule tetap, deadline tolerance berubah.
