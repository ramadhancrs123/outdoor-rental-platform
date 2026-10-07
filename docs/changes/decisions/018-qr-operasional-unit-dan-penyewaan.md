# ADR-018 — QR Operasional Unit dan Penyewaan

**Status:** Accepted
**Tanggal:** 2026-10-03
**Scope:** Inventaris + Penyewaan + Panel Admin

## Tujuan

Menyiapkan fondasi database untuk dua QR operasional:

1. **QR Unit** — identity permanen unit fisik Inventaris.
2. **QR Penyewaan** — identity permanen transaksi penyewaan, termasuk sejak status draft.

Fondasi frontend sudah disiapkan pada tahap berikutnya, tetapi belum ada perubahan UI/UX. Generator QR, PDF label batch, dan template cetak thermal 58 mm sekarang tersedia sebagai service/utility foundation; komponen layar dan navigasi belum disentuh.

## Keputusan

### QR Unit

Tabel `qr_unit` menyimpan satu identity QR untuk setiap `unit_barang`.

Prinsip:

- satu unit memiliki satu QR identity aktif;
- token QR bersifat acak dan tidak memuat data sensitif;
- QR menunjuk ke `unit_barang_id`, bukan ke rental saat ini;
- perubahan status unit tidak mengganti identity QR;
- QR tetap dapat mengarah ke histori unit walaupun unit rented, maintenance, damaged, lost, atau inactive;
- unit tidak dihapus hanya karena QR tidak lagi digunakan.

### QR Penyewaan

Tabel `qr_penyewaan` menyimpan satu identity QR untuk setiap `penyewaan`.

Prinsip:

- QR dibuat sejak rental dibuat, termasuk `draft`;
- QR menunjuk ke `penyewaan_id`;
- status pembayaran tidak disimpan di dalam token;
- QR tidak menjadi bukti pembayaran finansial;
- QR hanya menjadi locator ke detail penyewaan;
- rental yang sudah historical tetap mempunyai QR identity selama record rental dipertahankan.

## Security Boundary

Token QR tidak berisi:

- nama penyewa;
- nomor telepon;
- nominal pembayaran;
- catatan internal;
- detail unit lengkap.

Resolusi QR harus melalui trusted function dan memvalidasi:

- authenticated admin;
- keanggotaan usaha;
- status QR.

Resolusi mengembalikan hanya identifier yang dibutuhkan frontend untuk melakukan deep-link dan mengambil detail melalui service domain masing-masing.

## Lifecycle

```text
Unit dibuat
↓
QR Unit dibuat otomatis

Rental dibuat
↓
QR Penyewaan dibuat otomatis
```

Backfill telah dilakukan untuk data existing.

## Mutation Safety

Trigger otomatis menggunakan `ON CONFLICT DO NOTHING`, sehingga pembuatan QR idempotent dan tidak menggandakan identity.

Foreign key menggunakan tenant-aware relation dan `ON DELETE RESTRICT`; QR tidak boleh membuat unit/rental historis dapat dihapus.

## Fondasi Frontend yang Sudah Disiapkan

Layer `src/features/qr-operasional` sekarang menyediakan:

- akses trusted untuk membaca dan resolve QR Unit/Penyewaan;
- pembentukan deep-link QR;
- generator QR SVG dan PNG;
- pembuatan PDF label QR individu/batch;
- template HTML print untuk label QR;
- pembuatan PDF nota rental ukuran 58 mm;
- template HTML printer thermal 58 mm;
- mapper dari detail rental ke model nota;
- test generator, PDF, dan template print.

Database juga memiliki query trusted `daftar_qr_unit` dan `daftar_qr_penyewaan` agar frontend dapat memperoleh token QR untuk kebutuhan cetak batch tanpa membuka tabel QR secara langsung.

## Keputusan UI/UX yang Sudah Diterapkan

### Navigasi Operasional Cepat

Slot navigasi bawah yang sebelumnya menampilkan **Inventaris** dengan ikon QR sekarang menjadi **Scan QR**.

Scan QR membuka satu dialog operasional yang dapat:

- memindai QR Unit;
- memindai QR Penyewaan;
- menerima tautan/token sebagai fallback ketika kamera tidak tersedia;
- setelah validasi server, mengarahkan admin langsung ke detail yang sesuai.

Perubahan ini mempertahankan jumlah slot navigasi sehingga tidak menambah kepadatan navigasi mobile.

### QR Unit pada Detail Inventaris

QR Unit tidak ditampilkan permanen sebagai gambar besar karena akan mengganggu detail Inventaris yang sudah padat.

QR ditempatkan sebagai aksi **Lihat QR Unit** pada tab **Aksi**. Saat dibuka:

- QR dapat dilihat dalam dialog;
- label individual dapat dicetak;
- label dapat diekspor PDF;
- identity QR tetap berasal dari token canonical database.

### Cetak QR Unit Batch

Halaman utama Inventaris memiliki aksi **Cetak QR Unit**.

Batch saat ini menggunakan unit yang sedang tersedia pada daftar/filter halaman tersebut. Admin dapat:

- memilih unit;
- melihat jumlah unit yang dipilih;
- membuka proses cetak label batch.

Guard UI memastikan tidak terjadi horizontal overflow pada viewport mobile 390px pada scenario verifikasi.

### QR Penyewaan pada Detail Penyewaan

Detail Penyewaan memiliki tombol **QR** di area header bersama status rental.

QR:

- tetap menjadi locator ke detail penyewaan;
- tidak dianggap sebagai bukti pembayaran;
- tidak mengubah state rental;
- dapat tersedia sejak draft karena identity QR memang dibuat sejak rental dibuat.

Nota PDF dan thermal printing **belum diekspos pada UI** sesuai keputusan scope tahap ini.

### Deep Link

QR Unit dan QR Penyewaan sekarang memiliki route resolver:

- `/qr/unit/:token`
- `/qr/penyewaan/:token`

Resolver memvalidasi token melalui trusted RPC lalu mengarahkan admin ke detail domain yang sesuai. QR tidak membuka data lintas tenant dan tidak melewati authorization.

## Verification UI

Verified pada viewport mobile 390x844:

- **Scan QR pada bottom navigation** — PASS
- **Batch QR Unit pada Inventaris** — PASS
- **QR Penyewaan pada Detail Rental** — PASS
- **QR deep-link → Detail Unit + preview QR Unit** — PASS
- diagnostics pada scenario verified: console error 0, page error 0, HTTP error 0, request failure 0.

Targeted static checks:

- ESLint layer QR + UI terkait — PASS
- QR/Inventaris/Penyewaan targeted tests — **24/24 PASS**

Full `tsc --noEmit` belum dinyatakan PASS karena proses repository secara keseluruhan sebelumnya mengalami timeout; ini tidak dijadikan blocker khusus QR foundation selama targeted checks tetap hijau.

## Patch Setelah Uji Mobile Fisik

### Kamera QR pada HTTP LAN

Uji pada Android melalui alamat LAN HTTP menunjukkan kamera live browser tidak dapat memakai getUserMedia(). Ini adalah batas secure context browser, bukan kerusakan kamera perangkat. Browser mensyaratkan akses kamera web melalui secure context; HTTPS adalah jalur normal untuk koneksi jaringan. citeturn176359search0turn176359search1

UI sekarang tidak lagi berhenti pada pesan generik **Kamera QR tidak tersedia di perangkat ini**. Pada kondisi insecure/non-support, UI beralih ke fallback:

```text
Buka Kamera
    ↓
ambil foto QR melalui kamera perangkat
    ↓
decode QR
    ↓
trusted resolve
    ↓
detail Unit / Penyewaan
```

Fallback kode/tautan QR tetap tersedia.

### Batch Print Tanpa Pop-up

Implementasi sebelumnya menggunakan window.open(), sehingga browser dapat memblokir jendela baru dan menghasilkan tab kosong.

Implementasi sekarang tidak lagi membuka tab baru. Dokumen print dirender melalui hidden iframe pada halaman yang sama, lalu print() dipanggil dari frame tersebut. Batch juga memiliki fallback **PDF** agar operator tetap mempunyai jalur output tanpa bergantung pada pop-up.

Verification tambahan mobile 390×844:

- **Scan QR HTTP → fallback Buka Kamera — VERIFIED**
- **Batch Cetak QR → tidak membuka tab baru — VERIFIED**
- **Batch PDF fallback — VERIFIED**
- **QR Penyewaan detail tetap tampil — VERIFIED**
## Verification Follow-up — 2026-10-03

### P1 — Scanner QR

Root cause terverifikasi:

- Pada secure runtime http://127.0.0.1:5173, isSecureContext=true, navigator.mediaDevices.getUserMedia=true, tetapi native BarcodeDetector=false.
- Pada HTTP LAN http://10.88.210.205:5173, secure context tidak tersedia sehingga getUserMedia memang tidak tersedia.
- Implementasi tidak lagi menjadikan BarcodeDetector sebagai gate kamera.
- Satu library scanner digunakan: @zxing/browser@0.2.1.
- Rear camera diminta melalui facingMode=environment, dengan deviceId fallback.
- Permission error, insecure context, camera unavailable, invalid QR, manual fallback, dan cleanup stream ditangani.
- QR Unit dan QR Penyewaan tetap melewati trusted resolver yang sudah ada.

Browser evidence:

- Mobile viewport 390×844, secure-context capability probe — VERIFIED, diagnostics 0.
- Mobile viewport 390×844, HTTP LAN fallback — VERIFIED, diagnostics 0.
- QR fixture nyata → ZXing image capture → trusted resolve_qr_unit → detail unit — VERIFIED, diagnostics 0.
- Live physical camera pada perangkat Android nyata BELUM DIVERIFIKASI oleh harness ini; tidak boleh dianggap terbukti hanya dari mobile emulation/headless browser.
- HTTP LAN sekarang secara eksplisit menampilkan **Kamera live membutuhkan HTTPS** dan tidak lagi menawarkan tombol file-input dengan label “Buka Kamera”.
- Pada secure context, scanner tetap menggunakan MediaStream + ZXing; file/foto hanya fallback ketika kamera live memang unavailable/permission-denied.
- Vercel Preview pertama (38704e8) gagal pada Rollup karena @zxing/library tidak terpasang ketika Vercel menggunakan npm dan repository memiliki legacy-peer-deps=true; @zxing/browser memang mendeklarasikan @zxing/library sebagai peer dependency.
- Vercel Preview kedua (e8114ad) berpindah ke pnpm install, tetapi deployment berhenti dengan error generik Command "pnpm install" exited with 1; connector runtime yang tersedia tidak menyediakan detail log install. Secara lokal, pnpm install --frozen-lockfile tetap PASS.
- Preview branch kemudian menambahkan packageManager: pnpm@10.33.0, dependency ZXing core eksplisit, dan menormalkan pnpm-workspace.yaml menjadi allowBuilds.esbuild=true serta allowBuilds.msw=true karena pnpm menggunakan allowBuilds untuk lifecycle-script approval. Preview ketiga sedang BUILDING dan belum boleh dianggap VERIFIED.
- Production tidak disentuh.

### P2 — Batch Print QR Unit

- Popup timing tidak digunakan.
- Print surface menggunakan hidden iframe + srcdoc pada halaman yang sama.
- Batch default disusun 2 kolom × 4 baris pada A4 portrait.
- QR dan kode unit tetap ditampilkan.
- PDF A4 fallback tersedia.
- Single QR Unit print dan PDF juga diverifikasi.
- Mobile 390×844 — VERIFIED.
- Desktop 1280×800 — VERIFIED.
- Print iframe, aturan A4, QR data, dan label unit diverifikasi di runtime.
- Tidak ada blank/new tab dari print flow.

### Database / Security

- qr_unit dan qr_penyewaan sudah ada; tidak ada migration baru yang diperlukan untuk stabilisasi ini.
- resolve_qr_unit, resolve_qr_penyewaan, daftar_qr_unit, daftar_qr_penyewaan tersedia.
- Table RLS aktif.
- Public RPC wrapper hanya executable untuk authenticated dan service_role.
- Implementasi internal app_private.* menggunakan SECURITY DEFINER, search_path kosong, auth.uid(), dan validasi membership usaha.
- Supabase security advisor menandai RLS tanpa policy pada kedua tabel QR sebagai INFO; desain saat ini mengandalkan trusted RPC, bukan direct table access.

### Validation Gate

- qr-operasional.test.ts — 7/7 PASS.
- inventaris.service.test.ts — 10/10 PASS.
- penyewaan.service.test.ts — 9/9 PASS.
- Total targeted — 26/26 PASS.
- ESLint target files — PASS.
- tsc --noEmit — PASS.
- Browser verification mobile/desktop untuk batch dan detail QR — PASS.
- QR Penyewaan existing detail flow — PASS.
- Production visual verification masih terhalang Vercel Access perimeter (HTTP 403 sebelum app login); ini bukan evidence kegagalan QR.

## Handoff — QR Operasional Stabilization

### Tujuan
Menstabilkan Scan QR bottom navigation dan batch QR Unit tanpa mengubah semantic QR.

### Yang Sudah Selesai
ZXing scanner integration, camera capability handling, fallback image/manual flow, stream cleanup, A4 batch layout, hidden-iframe print, PDF fallback, single-label verification, dan regression verification QR Penyewaan.

### Yang Belum Selesai
Live camera decode pada perangkat Android fisik belum dapat diverifikasi langsung dari harness saat ini.

### File Terdampak
- rental-admin/package.json
- rental-admin/pnpm-lock.yaml
- src/components/qr-operasional/qr-operasional.tsx
- src/features/qr-operasional/types.ts
- src/features/qr-operasional/print.ts
- src/features/qr-operasional/pdf.ts
- src/tests/qr-operasional.test.ts
- browser verification scenarios QR terkait

### Kontrak
QR Unit tetap identity unit. QR Penyewaan tetap identity penyewaan. Token tidak menyimpan nama penyewa, nomor telepon, nominal pembayaran, atau data sensitif.

### Risiko
Jangan menganggap physical-camera gate selesai sebelum diuji pada perangkat/browser nyata. Jangan mengubah database QR semantic hanya untuk menyelesaikan UI scanner.

### Follow-up
Lakukan satu verification pass pada Android/browser fisik dengan HTTPS/secure context, termasuk permission allow/deny dan rear-camera decode. Sampai itu tersedia, Wave QR tidak ditutup sebagai VERIFIED penuh.

## Tahap Berikutnya

Nota rental + QR + PDF + thermal 58 mm tetap BLOCKED sampai physical-camera gate P1 diselesaikan dan seluruh QR Wave dinyatakan VERIFIED penuh.
