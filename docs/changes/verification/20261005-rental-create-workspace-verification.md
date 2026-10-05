# Verification — Rental Create Workspace (2026-10-05)

**Status:** VERIFIED FOR FEATURE SCOPE

## Target

Mengganti layar lama **Penyewaan Langsung** yang masih berbentuk wizard 4 langkah menjadi satu operational workspace Rental sesuai desain dua halaman proyek.

## Scope

- Route tetap `/penyewaan/walk-in`.
- Backend command dan business semantics tidak diubah.
- Ownership domain tetap pada Penyewaan, Penyewa, Katalog, Inventaris, dan Keuangan.
- Wizard/stepper UI lama dihapus dari golden path.
- Seluruh bagian utama tampil dalam satu halaman:
  - Penyewa
  - Periode Penyewaan
  - Barang dan Paket yang Disewa
  - Tinjauan Transaksi
- Tombol navigasi langkah lama dihapus.
- Aksi akhir tetap menggunakan command pembuatan rental yang sudah ada; tidak diubah menjadi aktivasi rental karena activation command memiliki kontrak terpisah.

## Evidence

### Static validation

- ESLint `src/pages/penyewaan/walk-in.tsx`: PASS.
- Full Vitest: **35 test files / 193 tests PASS**.
- Full TypeScript `tsc --noEmit --pretty false`: PASS.
- `git diff --check`: PASS.
- Tidak ditemukan lagi `setStep`, `aria-current="step"`, atau label tombol wizard lama pada layar Rental.

### Browser verification

Scenario:

`scripts/browser-verify/scenarios/penyewaan-rental-workspace.mjs`

Flow:

`/penyewaan`
→ klik **Penyewaan Langsung**
→ `/penyewaan/walk-in`
→ verifikasi workspace satu halaman.

#### Mobile 375×812

**VERIFIED**

- Heading `Rental Baru` tampil.
- Penyewa, Periode Penyewaan, Barang dan Paket yang Disewa, dan Tinjauan Transaksi tampil dalam satu workspace.
- Stepper lama tidak tampil.
- Tombol `Lanjut ke periode`, `Lanjut ke barang`, `Review Transaksi`, dan `Buat Draf Penyewaan` tidak tampil.
- Kontrol Barang, Paket, dan Buat Rental tersedia.
- Tidak ada horizontal overflow.
- Console errors: 0.
- Page errors: 0.
- HTTP errors: 0.
- Request failures: 0.

#### Desktop 1280×800

**VERIFIED**

Evidence sama dengan mobile; tidak ada diagnostic error atau horizontal overflow.

## Files changed

- `src/pages/penyewaan/walk-in.tsx`
- `scripts/browser-verify/scenarios/penyewaan-rental-workspace.mjs`

## Guardrails

Tidak ada perubahan ke Supabase, migration, production deployment, commit, atau push dalam scope ini.

## Next action

Tidak ada perubahan tambahan yang diperlukan untuk bug UX ini. Route lama tetap dipertahankan untuk kompatibilitas; yang diubah adalah presentation/workspace golden path.
