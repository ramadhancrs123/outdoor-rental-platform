# MNT-ADR — Biaya Aktual Perawatan → Pengeluaran + Cash Out Akun Uang

Status: ACCEPTED FOR IMPLEMENTATION
Tanggal: 2026-10-04
Scope: Perawatan only

## Keputusan
Ketika admin menyelesaikan Perawatan dan mengisi Biaya aktual > 0, biaya tersebut harus:
1. menjadi fakta Pengeluaran Finance dengan source maintenance;
2. langsung diselesaikan melalui cash out dari satu atau beberapa Akun Uang;
3. transaksi cash out harus berhasil terlebih dahulu sebelum Perawatan boleh berpindah ke status completed.

Jika saldo satu Akun Uang tidak cukup, admin dapat mengalokasikan sisa biaya ke Akun Uang aktif lain.
Jika total saldo yang tersedia dari akun-akun yang dipilih tidak cukup, seluruh command ditolak dan Perawatan tetap in_progress.

## Invariant
Biaya aktual → Pengeluaran Finance → Settlement akun uang → Perawatan completed

## Multi-account
Satu Pengeluaran dapat memiliki beberapa settlement.
Contoh: Expense Rp125.000 = Akun A Rp75.000 + Akun B Rp50.000.
Total settlement wajib sama dengan nominal expense pada flow cash-out Perawatan.
Saldo akun dihitung dari saldo awal + uang masuk recorded - uang keluar recorded.

## Batas Scope
Perubahan ini belum mengubah UX Pembelian atau input Pengeluaran manual di halaman Keuangan.
Keduanya akan memakai primitive multi-account yang sama pada tahap berikutnya setelah flow Perawatan diverifikasi.

## Alasan
Tujuan utama adalah memendekkan workflow admin: Perawatan → isi biaya aktual → pilih sumber uang → bayar → selesai.

## Acceptance
- Biaya aktual > 0 tanpa akun uang tidak dapat diselesaikan.
- Alokasi boleh memakai lebih dari satu akun.
- Alokasi tidak boleh melebihi saldo akun masing-masing.
- Total alokasi harus sama dengan biaya aktual.
- Saldo gabungan yang tidak cukup menyebabkan seluruh operasi ditolak.
- Pengeluaran, settlement, movement akun, audit, dan completion berada dalam boundary transaksi yang sama.
- Retry tidak membuat duplicate expense atau duplicate cash out.
- Setelah berhasil, Perawatan memiliki link ke Pengeluaran Finance.