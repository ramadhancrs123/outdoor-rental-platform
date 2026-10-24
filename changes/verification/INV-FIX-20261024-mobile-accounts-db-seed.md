# INV-FIX-20261024 — Mobile Accounts Bug + DB Reset + 3 Akun Uang + Verifikasi Fungsionalitas Investor

## Ringkasan

Sesi perbaikan pra-rilis fitur Investor/Finance. Semua perubahan mengikuti skenario
dokumen "percakapan investor final" tanpa mengubah model bisnis, skema, trigger,
atau function. UI/UX tidak diubah.

## 1. Ownership directory

- Direktori `rental-admin/` dialihkan dari `sentinelx` ke `arch-din1` via
  `sudo chown -R arch-din1:arch-din1 rental-admin` (dieksekusi oleh user).
- Diperlukan karena `src/pages/investor/`, `docs/`, `changes/` sebelumnya locked.

## 2. Bug mobile: tab "Akun" halaman Investor

- **Gejala**: error pada tampilan mobile, normal di laptop.
- **Akar masalah**: 34 pemakaian `crypto.randomUUID()` langsung di
  `src/pages/investor/index.tsx` (33) dan `src/pages/investor/config.tsx` (1).
  `crypto.randomUUID` hanya tersedia pada secure context (HTTPS/localhost).
  Mobile membuka app via `http://<ip-lan>` → `TypeError: crypto.randomUUID
  is not a function` saat komponen kartu aksi finansial dirender.
- **Fix**: ganti semua panggilan ke `createClientId()` dari
  `src/lib/client-id.ts` (sudah punya fallback + test
  `src/tests/client-id.test.ts`).
- Tidak ada perubahan UI/UX; hanya mekanisme pembuatan ID.

## 3. Reset data dummy database

- Semua data dummy transaksional/katalog/operasional/keuangan/investor dihapus
  dalam SATU transaksi (FK-safe, urutan anak→induk; siklus FK investor↔akun
  diselesaikan dengan urutan khusus).
- Trigger user-level di-disable HANYA dalam transaksi cleanup lalu di-enable
  kembali (guard `prevent_inventory_assignment_delete` memblokir hapus histori).
- Hasil: semua tabel data = 0; `usaha`, `akun_admin`, `keanggotaan_usaha`
  dipertahankan (1/1/1).
- Verifikasi: 98 trigger di schema public, `not_fully_enabled = 0` (semua aktif).
- Tidak ada DDL; skema/function/trigger utuh.

## 4. Bootstrap 3 akun uang (via jalur RPC resmi, bukan SQL langsung)

Auth user investor demo dibuat (email `investor@akasha.com`, password demo
`InvestorDemo2026!` — WAJIB diganti sebelum rilis). Seluruh pembuatan melalui
command resmi dengan idempotency_key + request_id sehingga audit/outbox terekam:

| Akun | Kode | Fungsi | Status |
|---|---|---|---|
| Kas Operasional | OPS-001 | operasional | active |
| Rekening Bank Operasional | OPS-002 | operasional | active |
| Kas Investor | INV-001 | investor (pemilik: Investor Demo) | active |
| Kas Pengelola | PGL-001 | pengelola (akun admin super_admin) | active |

Config investor (participation, effective-dated efektif 2026-10-01):
- percentage 15%, reserve Rp 1.000.000, periode bulanan start_day=1 → end_day=31
- basis `net_operational_result`
- Saldo awal Kas Operasional Rp 10.000.000 via `command_set_saldo_awal_akun`

Catatan teknis: konfigurasi awal 1→1 menghasilkan periode 1 hari; dikoreksi
menjadi 1→31 sesuai skenario "pembagian akhir bulan". Artefak periode uji 1 hari
(alokasi + periode + realtime event) dibersihkan tanpa menyentuh struktur.

## 5. Verifikasi fungsionalitas (semua via RPC resmi, authenticated admin)

| Uji | Hasil |
|---|---|
| Transfer internal OPS-001→OPS-002 Rp 1jt | ✅ tercatat; saldo 8,5jt / 1jt |
| Pengeluaran operasional + cash out Rp 500rb (1 langkah, alokasi multi-akun) | ✅ saldo turun tepat |
| N1 Transfer melebihi saldo (overdraft) | ✅ DITOLAK `BUSINESS_CONFLICT: saldo akun tidak cukup` (G-09) |
| N2 Cash out melebihi saldo | ✅ DITOLAK |
| N3 Cash out dari akun Investor (non-operasional) | ✅ DITOLAK (boundary akun) |
| N4 Alokasi cash out tidak balance | ✅ DITOLAK |
| `get_investor_overview` (admin) | ✅ status OK, periode 1 Okt→1 Nov OPEN, DIRECT_FRESH, principal=admin |
| Negative result: net = −500.000 | ✅ `investor_entitlement = 0` (G-07) |
| `command_close_investor_period` | ✅ closed; alokasi investor=0, operator=0; distributable 8,5jt setelah reserve 1jt |
| Self-transfer investor saldo 0 (claims investor) | ✅ DITOLAK `BUSINESS_CONFLICT: saldo akun Investor tidak cukup` |
| Guard pembuatan partisipasi (effective_from harus tepat hari mulai periode) | ✅ aktif |

## 6. Verifikasi kode

| Check | Hasil |
|---|---|
| `npx tsc --noEmit` | PASS |
| `eslint src/pages/investor/*.tsx` | PASS (0 error) |
| Investor tests (contract, self-transfer, history, open-period-advance) | 19/19 PASS |
| Full suite | 218/222 PASS; 4 failure PRE-EXISTING di luar scope: inventaris (1), pengembalian (2), penyewaan (1) |
| `npm run build` (produksi) | PASS (1m30s; warning chunk size non-blocking) |

## 7. Sisa data uji di database (transparansi)

Data berikut adalah transaksi ASLI hasil verifikasi (bukan dummy ilegal), dapat
dipakai sebagai data awal atau dihapus ulang bila diinginkan:
- 2 transaksi (saldo awal 10jt + expense 500rb), 1 transfer, 3 pergerakan akun
- 1 investor + 1 participation (15%, 1→31) + 0 periode tertutup
- audit_log 13, outbox 12, idempotency terkait seed/test

## 8. Belum selesai (untuk sesi berikutnya)

- Ganti password investor demo + verifikasi login investor end-to-end di browser
- E2E browser authenticated (mobile viewport untuk regression bug tab Akun)
- Revoke grant `anon` pada 4 tabel keuangan (`transfer_akun_keuangan`,
  `penyelesaian_pengeluaran`, `saldo_awal_akun_keuangan`,
  `pengembalian_dana_pembayaran`)
- Aktifkan leaked-password protection di Auth settings
- Index FK domain keuangan/investor (40 FK tanpa index penutup)
- Income end-to-end (payment dari penyewaan) belum diuji karena membutuhkan
  seed unit/barang operasional

## 9. Sesi lanjutan (20261024 — penyelarasan RBAC, 3 akun persis, form akun, UX closing)

### 9.1 RBAC selaras
- `src/app/providers/auth.ts`: filter `role='super_admin'` pada identitas admin
  (selaras dengan `assert_finance_admin` di backend). Fail-closed: admin non-super
  tidak lagi dianggap admin oleh UI.

### 9.2 Alur uang penyewaan → akun operasional (telusuri, tidak diubah)
- `penyewaan/show.tsx` → form pembayaran (`keuangan/create-payment.tsx`)
- Daftar akun sumber **sudah difilter `fungsi_akun==='operasional'`**
  (`features/keuangan/service.ts` `listFinanceAccounts`)
- Mutasi via `command_record_payment_with_account`; guard DB
  `guard_finance_account_movement` menolak payment ke akun non-operasional.

### 9.3 Kembali ke persis 3 akun
- OPS-002 (Rekening Bank Operasional, dibuat untuk uji transfer) dihapus bersama
  artefak ujinya (1 transaksi transfer + 2 pergerakan + baris transfer) dalam satu
  transaksi. Saldo OPS-001 kembali tepat Rp 9.500.000.
- Keputusan skema: model 3-pool adalah model FUNGSI (operasional/investor/pengelola),
  bukan lokasi fisik; multi-lokasi (kas+bank) tetap didukung kapan pun dibutuhkan.

### 9.4 Form pembuatan akun "Akun Uang Baru" ditingkatkan (accounts.tsx)
- Pilihan **fungsi akun**: Operasional / Investor / Pengelola
- Investor → picker investor aktif (`listInvestorAdminPrincipals`);
  Pengelola → picker operator (`listInvestorAdminOperators`), lalu
  `command_set_finance_account_role` otomatis dipanggil
- **Penempatan saldo awal** (opsional, hanya akun operasional): nominal + tanggal,
  via `command_set_saldo_awal_akun` (wrapper baru `setFinanceOpeningBalance`
  di `features/keuangan/service.ts` + type `FinanceOpeningBalanceInput`)
- Validasi: investor/pengelola wajib memilih pemilik; saldo awal dilarang untuk
  akun holding (mulai nol, diisi dari pembagian hasil)

### 9.5 UX tutup periode & pembagian hasil (index.tsx AccountsTab)
- Tombol "Tutup Periode" → panel ringkasan **dalam bahasa admin lapangan**:
  Hasil periode → Cadangan operasional (tetap di Akun Usaha) → Dana yang dibagi →
  Bagian Investor (%) → Bagian Pengelola
- Menyebut eksplisit: angka estimasi, final dihitung server saat ditutup, periode
  terkunci, koreksi lewat jalur koreksi tercatat
- `window.confirm` diganti panel in-page dengan tombol Batal / "Konfirmasi & Bagi
  Hasil"; error mutation tampil di panel

### 9.6 Verifikasi
- tsc PASS; eslint (4 file) PASS; investor+keuangan tests 38/38 PASS;
  build produksi PASS.


### 9.7 Status akhir sebelum manual testing
- 3 akun kosong: OPS-001 (operasional), INV-001 (investor), PGL-001 (pengelola)
- Investor: 1 baris aktif (Investor Demo), partisipasi 15%, periode 1→31
- Usaha + admin login utuh
- Semua transaksi dummy = 0; audit/outbox/idempotency/notifications/realtime = 0
- Trigger 98 semua aktif; DDL = 0; DB siap manual testing

