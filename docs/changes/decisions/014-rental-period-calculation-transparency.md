# ADR 014 - Perhitungan Periode Rental Transparan

## Keputusan

Untuk tarif berbasis durasi, jumlah periode dihitung dengan pembulatan ke atas:

periode = ceil(durasi rental / durasi tarif)

Minimum 1 periode.

Contoh untuk tarif 1 hari:
- 03 Okt 07:14 sampai 04 Okt 07:14 = 1 periode.
- 03 Okt 07:14 sampai 04 Okt 07:16 = 2 periode.

Tolerance tetap terpisah dari harga dan periode:

tolerance_deadline = scheduled_return_at + tolerance_hours

## UX

Step Periode Penyewaan wajib memperlihatkan:
- waktu mulai;
- waktu kembali terjadwal;
- durasi aktual;
- proyeksi periode tarif harian;
- peringatan jika melewati 24 jam;
- batas toleransi;
- penjelasan bahwa harga final mengikuti tarif yang dipilih pada langkah Barang/Paket.

Tidak boleh ada pembulatan periode yang hanya terjadi diam-diam tanpa penjelasan kepada admin.

## Acceptance

Untuk 03 Okt 07:14 sampai 04 Okt 07:16 dengan tolerance 10 jam:
- durasi = 1 hari 2 menit / 24,03 jam;
- periode tarif harian = 2;
- tolerance deadline = 04 Okt 17:16;
- paket tarif Rp400.000/hari menjadi Rp800.000 untuk quantity 1.

Perhitungan server pada command_create_direct_rental tetap menjadi authority akhir saat draft disimpan.
