# Investor & Finance — Release Gate

Tanggal verifikasi: 2026-10-11 (Asia/Jakarta)

## Keputusan

**BLOCKED_FOR_PRODUCTION_RELEASE.** Perubahan frontend berhasil dibangun dan pemeriksaan terarah lulus. Namun migration yang diperlukan belum diterapkan pada Supabase remote, happy-path command transfer belum diverifikasi melalui authenticated database integration test, full suite masih memiliki 4 kegagalan Inventaris yang telah terlihat pada baseline sebelumnya, dan tidak ada candidate commit SHA baru. Jangan deploy ke production pada state ini.

## Scope yang ditangani

- Menjaga konfigurasi Investor sebagai master di Finance; halaman Investor membaca hasil backend.
- Status realtime Investor hanya menampilkan `Live` saat koneksi benar-benar `LIVE`; `CONNECTING` dan `STALE` dibedakan.
- Menjaga principal admin-first selaras dengan ADR-005.
- Mempertahankan pemisahan hasil operasional, kas aktual, reserve/distributable cash, hak alokasi, pembayaran, transfer hak, dan transfer internal uang.
- Menambahkan server-side guard perubahan fungsi akun, jurnal realtime yang dapat direkonsiliasi saat delivery gagal, dan internal account transfer dengan actor Investor.
- Membatasi transfer internal Investor ke akun miliknya sendiri atau akun Usaha; aturan bisnis satu Investor aktif per Usaha tetap dipertahankan.
- Memperbaiki scenario browser history agar memeriksa kontrol yang sesuai dengan status periode OPEN atau CLOSED.
- Read model mutasi Finance kini mengizinkan actor Investor nullable admin dan memberi label transfer internal dengan istilah Indonesia.
- Bukti pengeluaran sudah menggunakan pemilih file, validasi tipe/ukuran, upload ke bucket privat, dan tanggal default zona waktu Usaha.

## Evidence — local

- `git diff --check`: PASS.
- `tsc --noEmit`: PASS, exit code 0.
- ESLint untuk file Investor/Finance dan browser scenarios yang disentuh: PASS, exit code 0.
- Focused Vitest: **8 file / 40 test PASS** (`investor.contract`, `investor.history`, `investor.open-period-advance`, `investor.self-transfer`, `keuangan.realtime`, `keuangan.f3`, `keuangan.service`, `keuangan`).
- `vite build`: PASS. Existing warnings remain: static/dynamic import overlap for penyewaan and chunks above 500 kB (largest app chunk ~1.16 MB minified).
- Browser verification on local Vite `http://127.0.0.1:5173`, without saving financial configuration or submitting financial mutations:
  - Investor dashboard: mobile 390x844 PASS; desktop 1440x1000 PASS; no console/page/HTTP/request errors.
  - Investor config contract: mobile PASS; desktop PASS; invalid values block Save; no Save was clicked.
  - Finance accounts/Investor balances: mobile PASS; desktop PASS; no console/page/HTTP/request errors.
  - Investor finance history: mobile PASS; desktop PASS; scenario branches on OPEN advance vs CLOSED settlement; no console/page/HTTP/request errors.
  - Finance navigation/period: mobile PASS; desktop PASS.
- Full Vitest suite last run: **214 passed / 4 failed across 41 files**. All four failures are in `src/tests/inventaris.test.tsx` (physical-unit facts, trusted registration entry point, mobile detail-link accessibility, mobile vocabulary/actions). These are known from the prior baseline, but the full suite is not green.

## Database migration verification

- Remote Supabase project: `nbirkybutpvtrqifaxlt` (`outdoor-rental-platform`). Latest applied migration observed: `20261010033626_investor_close_period_advance_reconciliation`.
- Pending local migrations: `20261010050845_finance_investor_realtime_and_account_role_hardening.sql` and `20261011090000_investor_internal_account_transfer.sql`.
- Both pending migrations were applied sequentially to a disposable local PostgreSQL scratch database successfully.
- Scratch DB ACL verification: anonymous execution denied for `public.command_investor_account_transfer`; authenticated execution allowed; old `public.command_investor_self_transfer` execution revoked; realtime trigger function execution revoked from application roles; account-role guard available to authenticated through its trusted path; one-active-Investor index/trigger preserved.
- This was schema/ACL verification only. A live authenticated happy-path transfer, insufficient-balance rejection, idempotent retry, realtime journal recovery, and balance reconciliation were **not** proven end-to-end against the remote database. No migration was applied to Supabase remote and no financial data was changed remotely.

## Source control / deployment gate

- Local branch: `production-demo-20261007`.
- Base HEAD: `515e0ddb5465789ec790452437d90f4dd4da45b6`.
- Worktree still contains modified and untracked feature files/migrations; no candidate commit was created.
- Vercel production latest observed deployment is READY for base SHA `515e0ddb5465789ec790452437d90f4dd4da45b6`. It does not contain the current uncommitted work.
- No commit, push, remote migration, preview deployment, or production deployment was performed.

## Required before release

1. Review the complete migration diff and commit the source, ADRs, tests, and verification evidence as a reproducible candidate SHA.
2. Resolve or formally baseline the 4 known Inventaris failures so release CI status is explicit.
3. Run authenticated database integration tests with authorized UAT identities against a disposable database or approved staging project: allowed transfer, insufficient balance, same-key retry, changed-payload key conflict, owner/tenant denial, two-ledger balance reconciliation, and realtime journal persistence when Broadcast delivery fails.
4. Verify admin-only, Investor-only, and dual-role principal behavior against the actual remote schema and auth context.
5. Obtain explicit production approval, then apply pending migrations in order and verify migration list, ACLs, functions/triggers, balances, realtime delivery/recovery, and post-deploy browser/runtime evidence.
