# ADR-012 — Paket Rental, Kapasitas Komponen, dan Multi-Line Rental

Status: ACCEPTED
Tanggal: 2026-10-02

## Context

Penyewaan rental outdoor mendukung dua bentuk target transaksi:

1. Sewa per barang/unit dengan jumlah tertentu.
2. Sewa paket yang tersusun dari beberapa komponen barang/varian.

Satu transaksi juga harus dapat mencampur keduanya, misalnya Carrier + Jaket + Tenda dalam satu penyewaan.

Ketersediaan paket tidak boleh diperlakukan sebagai angka stok manual. Sumber kebenaran tetap unit fisik pada Inventaris.

## Decision

### 1. Paket adalah komposisi, bukan unit stok baru

paket_sewa menjadi target komersial transaksi, sedangkan komponen_paket menyatakan kebutuhan fisik per paket.

Ketersediaan paket dihitung secara read-side dari kapasitas tiap komponen:

jumlah paket tersedia = MIN(floor(unit ready komponen / kebutuhan komponen per paket))

Bila salah satu komponen tidak mencukupi, paket berstatus operasional Stok Tidak Cukup dan tidak dapat dipilih untuk penyewaan pada quantity yang melebihi kapasitas.

Tidak dibuat counter stok paket terpisah.

### 2. Quantity paket diperluas ke komponen satu kali

Untuk package line:

kebutuhan komponen = quantity paket × jumlah komponen pada komposisi paket.

komponen_penyewaan.jumlah menyimpan kebutuhan komponen yang sudah diperluas.

Formula tidak boleh dikalikan lagi saat assignment atau pickup.

### 3. Multi-line rental adalah first-class

detail_penyewaan tetap menjadi line transaksi. Satu rental dapat memiliki banyak line dan dapat mencampur:

- barang/varian satuan;
- paket;
- barang/varian satuan + paket.

Kapasitas server divalidasi sebagai satu himpunan demand gabungan agar contoh seperti paket yang membutuhkan Carrier + line Carrier tambahan tidak dapat overbook hanya karena tiap line lulus sendiri-sendiri.

### 4. Assignment tetap per unit fisik

Paket tidak langsung menunjuk unit fisik.

Assignment melakukan resolusi:

detail_penyewaan → komponen_penyewaan → penetapan_unit → unit_barang

untuk setiap komponen yang membutuhkan unit.

Server membatasi jumlah assignment terhadap requirement komponen.

### 5. Pickup mengonsumsi seluruh unit secara atomik

Draft tidak mengubah status fisik unit.

Setelah semua unit package/item line selesai ditetapkan, proses pickup/serah-terima dalam satu transaksi memindahkan seluruh unit yang ditetapkan dari ready menjadi rented.

Tidak ada pengurangan stok manual yang terpisah dari unit_barang.

### 6. Return tetap unit-level, UI boleh grouped

Pengembalian tetap menerima unit fisik yang benar-benar kembali.

Untuk package rental, UI menampilkan progress paket dan komponen agar admin dapat melihat konteks paket, tetapi mutation tetap berbasis unit fisik.

### 7. Inspection → maintenance → readiness tetap berlaku per unit

Paket tidak mengubah golden path:

Penyewaan → Pengembalian → Pemeriksaan → Perawatan → Verifikasi Kesiapan → Ready

Setiap unit hasil return diproses pada lifecycle fisiknya sendiri. Paket hanya menjadi konteks pengelompokan.

## Operational UI

Inventaris memiliki mode Unit dan Paket.

Mode Paket menampilkan:

- nama paket;
- jumlah paket yang siap;
- komponen dan kebutuhan unit;
- ready count;
- unit sedang disewa;
- unit dalam pemeriksaan;
- unit dalam perawatan;
- shortfall komponen;
- peringatan Stok Tidak Cukup bila salah satu komponen menjadi bottleneck.

Mode ini adalah derived operational read model, bukan sumber stok baru.

## Consequence

Paket dan sewa per barang dapat berjalan bersama tanpa mengubah semantics inventory.

Satu transaksi multi-line tetap aman terhadap overbooking komponen yang sama karena kapasitas digabungkan di server.

Ketersediaan UI saat ini adalah snapshot fisik saat ini; server tetap melakukan revalidasi saat command pembuatan rental dieksekusi.

## Non-goals

ADR ini tidak mengubah:

- formula tarif;
- aturan toleransi;
- ownership Finance;
- aturan denda/kerusakan;
- otomatisasi return berdasarkan waktu;
- readiness otomatis setelah maintenance.
