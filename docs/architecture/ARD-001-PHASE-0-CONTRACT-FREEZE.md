# ARD-001 — Phase 0: Contract Freeze & Audit Arsitektur Aktual

**Produk:** Akasha Outdoor — Rental Admin <br>
**Dokumen induk:** `docs/architecture/ARD-001-event-promotions.md` <br>
**Tanggal audit:** 5 November 2026 <br>
**Branch:** `feat/unified-retail-sales-checkout` <br>
**Supabase project:** `nbirkybutpvtrqifaxlt` (`outdoor-rental-platform`, `ap-southeast-1`) <br>
**Status:** Phase 0 discovery, context, impact, dan rancangan kontrak selesai; belum ada implementasi kode atau database.

---

## 1. Ringkasan hasil Phase 0

Phase 0 telah mencocokkan ARD dengan struktur repository, kontrak RPC aktif, trigger/constraint, policy/grant, consumer frontend admin, dan consumer website yang saat ini tersedia.

**Keputusan bisnis yang dikonfirmasi pengguna sudah dimasukkan ke kontrak di bawah.** Audit menemukan beberapa gap yang harus masuk ke rencana implementasi agar perubahan promo tidak merusak batas domain rental dan retail:

1. Promo paket saat ini masih dapat dikonfigurasi dari dua permukaan Katalog, bukan satu pusat.
2. Permission promo/diskon belum granular. Role admin yang ada bersifat global, sedangkan keanggotaan usaha belum menyimpan role atau permission.
3. Promo paket memiliki `started_at` dan `ended_at`, tetapi belum mempunyai `valid_until` untuk akhir terjadwal.
4. Website belum mengonsumsi public package-promo view; website saat ini membaca tarif dan paket melalui view publik yang berbeda.
5. Validator harga rental masih mengharuskan `unit_price` sama dengan tarif nominal (atau harga promo paket). Promo katalog rental memerlukan perluasan validator dan snapshot.
6. Constraint retail saat ini menolak baris penjualan bernilai nol. Jika kebijakan promo 100% juga berlaku pada channel sale, skema retail perlu mendukung transaksi/baris gratis tanpa membuat pembayaran atau mutasi kas fiktif.
7. Checkout gabungan masih menghitung `total_amount = subtotal_rental + subtotal_penjualan`; belum ada komponen diskon rental.
8. Walk-in adalah jalur UI untuk membuat rental dari reservasi, tetapi konversi sekarang menyalin snapshot reservasi dan tidak mengizinkan perubahan item melalui picker. Perubahan kesepakatan perlu workflow eksplisit, bukan repricing diam-diam.

**Keputusan Phase 0:** ARD tetap menjadi baseline. Dokumen ini adalah addendum hasil audit dan keputusan yang disetujui; tidak menggantikan batas domain dalam ARD.

---

## 2. Kontrak bisnis yang dibekukan

### 2.1 Promo katalog barang/varian

- Promo katalog tetap berbasis **persentase per baris**, terpisah per channel `rental` dan `sale`.
- Harga normal rental berasal dari `tarif_sewa.nominal`; harga normal retail berasal dari `barang.harga_jual` atau override `varian_barang.harga_jual`.
- Promo tidak mengubah harga master.
- Promo varian mengalahkan promo induk. Bila tidak ada promo varian yang valid, resolver boleh fallback ke promo induk. Keduanya tidak dijumlahkan.
- Promo rental tidak mengubah harga sale dan sebaliknya.
- Promo katalog tidak diterapkan lagi pada komponen paket.
- Persentase promo katalog dibatasi maksimal 100% sesuai aturan bisnis dan validasi harga efektif tidak boleh negatif.

### 2.2 Promo paket rental

- `promosi_paket_sewa` dipertahankan; tidak dibuat tabel paket promo baru.
- Harga promo paket tetap berupa **nominal Rupiah**, bukan persentase.
- Promo paket berlaku hanya pada baris paket. Promo produk/varian tidak ditumpuk pada komponen paket.
- Tambahkan konsep akhir terjadwal `valid_until`; `ended_at` tetap berarti waktu admin benar-benar menghentikan promo.
- Batas waktu berlaku menggunakan interval `[started_at, valid_until)`. Promo tidak efektif sebelum `started_at`, pada/selepas `valid_until`, atau setelah diakhiri admin (`ended_at IS NOT NULL`).
- Harga promo 0 diperbolehkan oleh constraint paket yang saat ini ada, selama harga promo tidak melebihi harga normal.

### 2.3 Loyalitas — Model A

- Program loyalitas dapat diaktifkan/nonaktifkan per usaha.
- Ambang jumlah rental selesai dan persentase rekomendasi dapat diatur per usaha.
- Setelah jumlah completed rental mencapai ambang, kelayakan berlaku berkelanjutan selama program aktif dan dalam periodenya. Tidak ada counter yang berkurang setelah diskon digunakan; tidak ada poin, wallet, voucher, klaim, atau redemption.
- Frekuensi dihitung dari satu row `penyewaan` yang berstatus `completed` dan memiliki `actual_return_completed_at IS NOT NULL`; satu rental dihitung satu kali tanpa melihat jumlah detail, unit, paket, pembayaran, atau penjualan yang tergabung.
- Penjualan tidak menambah frekuensi loyalitas.
- Persentase hanya digunakan sebagai dasar perhitungan rekomendasi loyalitas. Nilai yang ditawarkan ke checkout dikonversi menjadi **nominal Rupiah**.
- Program nonaktif atau di luar periode tidak menghasilkan rekomendasi, walaupun pelanggan memiliki frekuensi yang cukup.

### 2.4 Promo Checkout

- Input, nilai yang dikirim ke backend, snapshot, dan nilai diskon aktual menggunakan **nominal Rupiah**.
- Tidak ada input persentase untuk diskon manual di Walk-in.
- Persentase loyalitas dikalikan dengan subtotal rental setelah promo baris (promo katalog rental dan promo paket), lalu dikonversi menjadi nominal rekomendasi.
- Sistem menampilkan rekomendasi; admin harus menekan `Pakai Promo` untuk menerapkannya. Rekomendasi tidak otomatis menjadi diskon aktual.
- Admin dapat mengubah nominal aktual sesuai permission dan kebijakan usaha.
- Diskon aktual adalah satu nilai tunggal. Bila nilainya melebihi rekomendasi loyalitas, selisihnya dicatat sebagai bonus/override, bukan diskon kedua.
- Diskon checkout hanya mengurangi rental. Subtotal penjualan, omzet retail, dan HPP tidak berubah.
- Diskon aktual tidak boleh negatif dan tidak boleh melebihi subtotal rental.
- Batas mutlak sistem adalah 100% dari subtotal rental. Jika usaha menginginkan batas yang lebih rendah untuk operasional, policy dapat membatasi dengan **batas nominal Rupiah**, bukan input persentase manual.
- Diskon tidak menghasilkan transaksi keuangan, pembayaran, pergerakan akun, maupun mutasi Kas Operasional.

### 2.5 Otorisasi admin

Pengguna mengonfirmasi tiga hak yang wajib dibedakan:

| Permission key konseptual | Tindakan |
|---|---|
| `event_promotion.manage` | Membuat, mengubah, menjadwalkan, mengaktifkan, dan menonaktifkan promo katalog, promo paket, loyalitas, serta kebijakan promo checkout. |
| `checkout_discount.apply` | Menerapkan promo loyalitas atau diskon manual nominal pada Walk-in. |
| `checkout_discount.override` | Memberikan diskon aktual di atas nominal rekomendasi loyalitas (bonus/override). |

Backend menjadi batas keamanan. Menyembunyikan tombol atau input pada frontend bukan otorisasi.

Hasil audit menunjukkan belum ada permission matrix granular di database maupun UI pengelolaan anggota. Saat ini `akun_admin.role` merupakan teks global dan `keanggotaan_usaha` hanya menyimpan hubungan/status keanggotaan. Satu-satunya role admin aktif yang ditemukan pada database saat audit adalah `super_admin`.

**Rekomendasi Phase 1:** permission diperiksa dalam konteks admin aktif + membership aktif pada `usaha_id` yang sedang dipakai. `super_admin` saat ini mendapat ketiga capability; role lain harus default-deny sampai capability-nya dipetakan secara eksplisit. Jangan menjadikan `akun_admin.role` global sebagai satu-satunya sumber izin per-usaha. Pilihan struktur penyimpanan grant (role-permission map atau capability pada membership) perlu ditetapkan sebelum migration; tidak ada struktur permission baru yang dibuat pada Phase 0.

### 2.6 Promo publik vs internal

- Promo katalog barang/varian mempunyai kontrol publik/internal eksplisit pada aturan promo (`is_public`, default aman `false`).
- Untuk promo paket, Phase 0 mempertahankan predicate public-package yang sudah ada. ARD belum menetapkan flag publik terpisah pada `promosi_paket_sewa`; keputusan itu tidak ditambahkan diam-diam. Resolver/view paket harus tetap memeriksa status paket publik, status dan periode promo, tenant aktif, serta tarif efektif.
- Data loyalitas, completed rental count, rekomendasi per pelanggan, diskon manual, alasan diskon, override, dan actor admin tidak boleh masuk read model publik.
- Public read model harus whitelist field dan tetap memakai tenant/public predicate; tidak mengekspos tabel konfigurasi admin secara luas.

### 2.7 Reservasi dan Walk-in

- Reservasi adalah satu fitur/workspace untuk seluruh kanal, baik permintaan website maupun reservasi yang dicatat admin. Smart Booking adalah aggregate dan workflow teknis yang sama, bukan fitur lain atau jenis reservasi terpisah.
- `app_private.akasha_smart_booking` adalah aggregate kanonis untuk antrean, kalender, customer, perubahan, status, dan tracking reservasi.
- `public.reservasi` tetap dipakai sebagai record kompatibilitas untuk command rental yang telah ada dan ditautkan one-to-one melalui `reservasi_id`. Record tersebut tidak menjadi entri kalender/daftar kedua dan tidak memiliki menu admin sendiri.
- Pembuatan dari website dan dari Permintaan Sewa admin wajib menghasilkan satu Smart Booking aggregate. Jalur admin menggunakan trusted RPC atomik `admin_create_akasha_smart_booking_from_request`.
- Reservasi adalah catatan kesepakatan dan jadwal; reservasi **bukan** record penyewaan dan tidak otomatis membuat rental.
- Rental operasional tetap dibuat melalui Walk-in. Kalender/agenda reservasi adalah read-only dan tidak mengalokasikan kapasitas atau unit.
- Harga/promo yang telah disepakati dan disimpan saat reservasi berhasil dibuat dikunci pada snapshot reservasi. Konversi tidak menghitung ulang promo terkini saat membaca snapshot; validasi operasional tetap dilakukan oleh trusted checkout command.
- Walk-in memvalidasi identitas penyewa, tanggal, status reservasi, serta ketersediaan stok sebelum membuat rental.
- Jika kesepakatan berubah, perubahan harga/item/jadwal harus dilakukan secara eksplisit melalui workflow amendment yang diaudit di Reservasi Center; jangan mengubah snapshot lama atau menghitung ulang promo diam-diam.
- Kebijakan loyalitas dan diskon checkout berlaku pada pembuatan rental Walk-in, bukan pada permintaan publik.

---

## 3. Audit kondisi aktual Supabase

### 3.1 Identitas lingkungan dan migration state

- Supabase project: `nbirkybutpvtrqifaxlt`.
- Branch repository: `feat/unified-retail-sales-checkout`.
- Migration remote terbaru yang tercatat pada saat audit: `20261105022844_mixed_checkout_activation_idempotency_compatibility`.
- Migration promo paket yang sudah diterapkan: `20261101233614_20261101233255_package_promo_backend`, disusul index dan lifecycle guard.
- Tidak ada migration promo katalog/loyalitas/promo checkout yang telah diterapkan.

### 3.2 Tabel dan kolom relevan

| Tabel | Kondisi aktual | Implikasi |
|---|---|---|
| `promosi_paket_sewa` | Ada: `harga_normal`, `harga_promo`, `status`, `started_at`, `ended_at`, audit creator/ender. Belum ada `valid_until`. | Dipertahankan; tambah jadwal akhir dan selaraskan public view/predicate dengan visibilitas paket. Flag publik promo terpisah belum menjadi kontrak. |
| `tarif_sewa` | Memiliki target barang/varian/paket, nominal, durasi, dan rentang berlaku. | Sumber harga normal rental. |
| `barang` | Memiliki `is_public`, `is_rentable`, `is_sellable`, `harga_jual`, dan inventory mode. | Harga jual dan visibilitas target sudah ada di master barang. |
| `varian_barang` | Memiliki `barang_id`, `is_public` tidak ada pada hasil kolom yang diaudit, `is_sellable`, `harga_jual`, dan inventory mode. | Visibilitas varian perlu mengikuti kebijakan target induk atau ditambahkan bila memang dibutuhkan; jangan mengasumsikan field publik varian ada. |
| `detail_penyewaan` | Ada target tunggal (`barang_id` atau `varian_barang_id` atau `paket_sewa_id`), `unit_price`, `subtotal`, `tarif_sewa_id`, `promosi_paket_id`. Belum ada snapshot promo katalog. | Pertahankan tepat satu target rental; tambah snapshot promo katalog tanpa mengisi dua target sekaligus. |
| `detail_reservasi` | Target tunggal, `unit_price`, `subtotal`, `tarif_sewa_id`, `promosi_paket_id`. Belum ada snapshot promo katalog. | Snapshot promo katalog perlu ikut disimpan saat reservasi dibuat. |
| `detail_penjualan` | `barang_id` wajib dan `varian_barang_id` opsional; ada snapshot HPP `harga_beli_satuan` dan `hpp_total`. Belum ada snapshot promo katalog. | Jangan menyamakan target sale dengan constraint target tunggal rental. Promo varian di sale tetap merujuk ke parent product + variant sesuai model retail. |
| `penyewaan` | `total_amount` sudah ada dan `CHECK total_amount >= 0`; belum ada `subtotal_amount` dan `discount_amount`. | Tambah dua nilai; jangan membuat total_amount duplikat. |
| `checkout` | Ada subtotal rental, subtotal penjualan, total, amount paid; constraint total masih penjumlahan dua subtotal. | Tambah `discount_rental_amount` dan ubah constraint setelah backfill. |
| `audit_log` | Ada actor, tenant, action, entity, request ID, change summary, reason. | Gunakan pola audit yang ada. |
| `idempotency_key` | Ada tenant, actor, command, request hash, response, expiry. | Semua command baru/perluasan wajib hash seluruh intent promo/diskon. |

### 3.3 Constraint penting yang ditemukan

- `detail_penyewaan_satu_target` dan `detail_reservasi_satu_target` menjamin tepat satu target rental/reservasi.
- `validate_rental_line_math()` adalah trigger `BEFORE INSERT OR DELETE OR UPDATE` pada `detail_penyewaan`; saat ini mensyaratkan `unit_price` sama dengan tarif normal, kecuali harga promo paket yang direferensikan. Promo katalog rental belum dikenal trigger ini.
- `validate_reservation_line_math()` hanya memeriksa matematika `subtotal = jumlah × unit_price`; validasi harga/promo dilakukan oleh command reservasi.
- `penyewaan.total_amount` mengizinkan nol; detail rental mengizinkan subtotal nol.
- `detail_penjualan.unit_price` dan `subtotal` harus positif; `penjualan.total_amount` harus positif; `checkout.subtotal_penjualan` dan `checkout.total_amount` juga harus positif. Karena itu, promo 100% pada channel sale belum kompatibel dengan constraint retail saat ini.
- `checkout_total_math` saat ini adalah `total_amount = subtotal_rental + subtotal_penjualan`.
- `checkout_paid_limit` membatasi `amount_paid <= total_amount`.
- Trigger pembayaran `trg_sync_checkout_payment_totals` menyinkronkan total pembayaran ke checkout. Diskon tidak boleh masuk trigger/ledger pembayaran sebagai uang yang diterima.

### 3.4 Promo paket dan public read model

- `promosi_paket_sewa` mempunyai constraint `harga_normal > 0`, `harga_promo >= 0`, `harga_promo < harga_normal`.
- Status saat ini hanya `active` atau `ended`. Constraint status mensyaratkan promo active belum memiliki `ended_at`, dan promo ended memiliki `ended_at`.
- Ada unique partial index `promosi_paket_sewa_one_active_per_tariff` pada `(usaha_id, tarif_sewa_id)` untuk seluruh row berstatus active. Index ini lebih ketat daripada sekadar mencegah overlap waktu: dua promo terjadwal yang sama-sama berstatus active pada tarif yang sama tidak dapat tersimpan, walaupun periodenya tidak tumpang tindih. Jika kebutuhan bisnis adalah menjadwalkan beberapa periode berurutan sekaligus, index/command perlu direvisi menjadi pemeriksaan overlap berbasis interval dengan locking.
- `resolve_package_promo_price()` adalah private resolver `SECURITY DEFINER`, `search_path` dikunci, dan execute hanya untuk postgres; dipakai oleh trusted command.
- `command_set_paket_promo()` berada dalam trusted command boundary dan mengandalkan `catalog_require_admin()`.
- `v_public_paket_promo` ada dan `security_invoker=true`, tetapi definisinya belum memuat `valid_until`. Visibilitas publik saat ini diturunkan dari predicate paket publik; flag promo paket terpisah belum ditetapkan oleh ARD. Website `rental-web` tidak memakai view ini saat audit; `rental-web/lib/catalog.ts` mengambil harga dari `v_public_tarif_sewa` dan paket dari `v_public_paket_sewa`.
- View promo publik diberi hak SELECT untuk anon, tetapi tabel dasar `promosi_paket_sewa` pada hasil privilege check tidak memberi SELECT langsung kepada anon. Karena view menggunakan `security_invoker`, akses publik harus diuji dan kontrak grant/RLS-nya diperbaiki secara eksplisit sebelum website memakai view tersebut. Jangan menganggap keberadaan view berarti promonya sudah terpublikasi.

### 3.5 Admin UI promo paket saat ini

Audit frontend menemukan editor promo paket pada dua tempat:

1. `src/pages/katalog/list.tsx` — editor promo pada konteks daftar/katalog.
2. `src/pages/katalog/package.tsx` — editor promo saat mengelola detail paket.

Service yang dipakai adalah `setCatalogPackagePromo()` di `src/features/katalog/service.ts`. `src/features/inventaris/service.ts` juga membaca `promosi_paket_sewa` untuk kebutuhan read model.

Target sentralisasi harus memindahkan mutasi ke Event & Promosi dan menghapus kedua editor konfigurasi tersebut setelah pusat baru siap. Katalog/detail paket tetap dapat menampilkan harga efektif, badge promo, dan tautan Kelola Promo. Consumer read-only tidak boleh ikut dihapus tanpa audit.

### 3.6 Role, membership, dan permission

Hasil audit skema dan data:

- `akun_admin.role` adalah `text` global, bukan role per usaha.
- Database saat audit hanya menunjukkan satu admin aktif dengan role `super_admin`.
- `keanggotaan_usaha` menyimpan `usaha_id`, `akun_admin_id`, status, joined/revoked timestamps; tidak memiliki kolom role atau permission.
- Tidak ditemukan tabel permission/role-permission untuk admin pada schema public.
- Tidak ditemukan UI pengelolaan role/permission admin di `src/pages`.
- `app_private.catalog_require_admin(p_usaha_id)` memeriksa auth user, akun admin aktif, dan membership usaha aktif/revoked_at NULL; fungsi ini tidak membedakan kemampuan mengelola promo, memberi diskon, atau override.
- Karena itu, tiga capability pada Bagian 2.5 harus benar-benar diperkenalkan melalui policy backend. UI role belum cukup sebagai security boundary.

### 3.7 Public website

- Workspace website yang ditemukan adalah `rental-web/`.
- Consumer katalog ada pada `rental-web/lib/catalog.ts`.
- Saat ini website query `v_public_tarif_sewa` untuk harga item dan `v_public_paket_sewa` untuk paket; tidak ada query `v_public_paket_promo` atau consumer promo katalog.
- Target publik barang dan paket sudah mempunyai kontrol `is_public`; flag visibility pada promo harus menjadi syarat tambahan, bukan pengganti visibility master target.
- Perubahan harga publik harus menginvalidasi cache katalog website (`public-catalog`) agar harga normal/efektif tidak stale.

---

## 4. Inventory RPC dan consumer yang terdampak

Signature berikut dibaca dari katalog function database Supabase aktual. Tidak ditemukan overload untuk fungsi-fungsi private pada query ini selain yang tercantum; fungsi `command_create_sale` memiliki dua overload publik.

| Domain | RPC/private command aktual | Signature ringkas | Security dan consumer |
|---|---|---|---|
| Rental Walk-in | `app_private.command_create_direct_rental` / `public.command_create_direct_rental` | `(uuid, uuid, timestamptz, timestamptz, jsonb, text, text, uuid)` | Private `SECURITY DEFINER`, `search_path=''`; public wrapper `SECURITY INVOKER`; authenticated. Dipakai `src/features/penyewaan/service.ts` dan `src/pages/penyewaan/walk-in.tsx`. |
| Reservasi dari Permintaan Sewa admin | `admin_create_akasha_smart_booking_from_request` | `(uuid, uuid, jsonb, text, uuid)` | Public definer wrapper + private trusted orchestrator. Memanggil command snapshot harga yang sudah ada, lalu membuat satu Smart Booking aggregate secara atomik. Dipanggil dari `src/features/reservasi/service.ts`. |
| Konfirmasi reservasi legacy | `command_confirm_reservation` | `(uuid, uuid, text, uuid)` | Trusted compatibility command untuk data `public.reservasi` yang tidak terhubung ke Smart Booking. Tidak menjadi command atau halaman kedua di Reservasi Center. |
| Rental dari reservasi legacy | `command_create_rental_from_reservation` | `(uuid, uuid, timestamptz, timestamptz, text, uuid)` | Compatibility path untuk data reservasi lama. Reservasi Center menggunakan Smart Booking atomic conversion agar sumber rental/penjualan ditautkan pada satu aggregate. |
| Penjualan POS | `command_create_sale` (public overload 1) | `(uuid, text, text, text, jsonb, uuid, text, text, uuid)` | Public wrapper invoker memanggil private sale command. Dipakai `src/features/penjualan/service.ts`. |
| Penjualan POS dengan source | `command_create_sale` (public overload 2) | `(uuid, text, text, text, text, jsonb, uuid, text, text, uuid)` | Public wrapper invoker; source dinyatakan eksplisit. Dipakai oleh service penjualan sesuai mode. |
| Penjualan terhubung penyewa | `command_create_sale_with_renter` | `(uuid, uuid, text, text, text, jsonb, uuid, text, text, uuid)` | Public wrapper saat ini `SECURITY DEFINER`; private counterpart juga trusted. Perlu review konsistensi wrapper/grant dan auth guard saat perubahan. |
| Core retail | `app_private.command_create_sale_unchecked_20261105` | `(uuid, text, text, text, text, jsonb, uuid, text, text, uuid)` | `SECURITY DEFINER`; execute private hanya postgres. Dipanggil internal oleh trusted sale/mixed command; bukan frontend. |
| Checkout gabungan draft | `command_create_mixed_checkout` | `(uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, uuid, text, numeric, timestamptz, text, text, uuid)` | Private definer + public invoker wrapper; authenticated. Dipanggil `createMixedCheckout()` dari Walk-in. |
| Checkout gabungan aktif | `command_create_mixed_checkout_and_activate` | Signature sama dengan checkout gabungan draft. | Private definer + public invoker wrapper; authenticated. Membungkus mixed checkout dan aktivasi/serah-terima dalam transaksi atomik. Dipanggil dari Walk-in. |
| Promo paket | `command_set_paket_promo` | `(uuid, uuid, uuid, boolean, numeric, timestamptz, text, uuid)` | Trusted command; saat ini dipanggil melalui `setCatalogPackagePromo()` di service Katalog. |
| Resolver paket | `app_private.resolve_package_promo_price` | `(uuid, uuid, uuid, timestamptz)` | Private definer, execute hanya postgres; tidak dipanggil dari browser. |

### 4.1 Trigger, view, dan payment dependencies

**Rental/reservasi:**
- `trg_rental_line_validate_math` → `app_private.validate_rental_line_math()` pada `detail_penyewaan`.
- `trg_reservation_line_validate_math` → `app_private.validate_reservation_line_math()` pada `detail_reservasi`.
- `trg_rental_detail_require_rentable_catalog` dan `trg_reservation_detail_require_rentable_catalog` menjaga target barang/varian yang dapat disewa.
- `trg_rental_status_validate` menjaga transisi status dan syarat completed; completed membutuhkan actual return start/completion dan seluruh unit kembali.
- `trg_penyewaan_validate` menjaga konsistensi header rental.

**Retail/keuangan:**
- `pembayaran` memiliki validation, transition, deferred financial consistency, event, updated_at, dan `trg_sync_checkout_payment_totals`.
- `transaksi_keuangan` memiliki transition/status consistency dan investor realtime triggers.
- `pergerakan_akun_keuangan` memiliki guard dan transition validation.
- Tidak ditemukan trigger promo/price khusus pada `penjualan`/`detail_penjualan`; pricing dan HPP snapshot berada pada trusted sale command.

**View penting:**
- `v_admin_rental_detail`, `v_admin_rental_queue`, `v_admin_reservation_queue`.
- `v_public_tarif_sewa`, `v_public_paket_sewa`, `v_public_paket_promo`.
- Finance/retail read model (`finance_summary`, `finance_payment_page`, `finance_retail_analysis`) perlu diperiksa dan diperluas hanya untuk menampilkan gross/promo/net; jangan membuat diskon sebagai arus uang.

---

## 5. Kontrak harga final dan dampak transaksi

### 5.1 Formula tunggal

```text
rental_line_effective_price = rental_base_tariff - catalog_line_discount
package_line_effective_price = package_promo_price (jika efektif), selain itu package tariff
sale_line_effective_price = sale_base_price - catalog_sale_discount

subtotal_rental = SUM(rental detail after line promotions)
recommended_loyalty_amount = ROUND(subtotal_rental * loyalty_percent / 100, 2)
discount_rental_amount = nominal final yang disetujui admin

total_rental = subtotal_rental - discount_rental_amount
subtotal_penjualan = SUM(sale detail after sale catalog promotion)
total_checkout = total_rental + subtotal_penjualan
remaining = total_checkout - amount_paid
```

### 5.2 Data snapshot yang disyaratkan

- `detail_penyewaan`, `detail_reservasi`, dan `detail_penjualan`: harga normal, persentase promo baris, nominal diskon baris, referensi promo katalog; harga efektif tetap pada `unit_price` dan subtotal tetap pada `subtotal`.
- Detail paket mempertahankan `promosi_paket_id`; jangan mengisi `promosi_katalog_id` untuk komponen paket.
- `penyewaan`: tambah `subtotal_amount` dan `discount_amount`; `total_amount` yang sudah ada menjadi nilai net.
- `checkout`: tambah `discount_rental_amount`; `subtotal_rental` tetap sebelum diskon checkout, `subtotal_penjualan` tetap net setelah promo sale, `total_amount = subtotal_rental - discount_rental_amount + subtotal_penjualan`.
- `penyewaan_diskon`: satu row opsional per rental yang menyimpan source loyalty/manual, basis, recommended percent/amount, applied input (amount), actual amount, bonus, alasan, program/config version, completed rental count snapshot, actor, request ID.

### 5.3 Batas nol dan 100%

- Promo paket harga 0 telah diizinkan schema.
- Rental header/detail telah mengizinkan nominal nol pada constraint, tetapi validator rental harus diperluas untuk harga efektif promo katalog 100%.
- Diskon checkout rental sebesar 100% dari subtotal dapat menghasilkan `total_rental=0`. Ini bukan pembayaran; jangan membuat baris pembayaran Rp0. UI/read model harus memperlakukan sisa kewajiban nol tanpa mengarang penerimaan kas.
- Retail saat ini menolak line/total 0. Jika 100% sale catalog promo termasuk kebijakan yang diinginkan, perlu perubahan positif-only checks dan lifecycle zero-pay sale/checkout yang eksplisit. Ini belum bisa dianggap didukung oleh schema saat ini.

---

## 6. Keputusan teknis dan migration sequence hasil Phase 0

Urutan implementasi yang disarankan setelah verifikasi:

1. **Permission contract:** tentukan grant storage dan provisioning role/capability; implementasi default-deny untuk role tanpa izin eksplisit.
2. **Promo catalog foundation:** tabel, FK tenant, target satu (barang atau varian), channel, period, `is_public`, audit, unique/overlap protection, RLS, dan trusted commands.
3. **Pricing resolver rental + sale:** resolver per channel dan satu timestamp `pricing_at`; server menghitung harga, bukan menerima harga final dari client.
4. **Snapshot rental/reservasi/retail:** perluas trusted commands dan validator/trigger. Reservasi mengunci snapshot pada saat berhasil dibuat; konversi dari Walk-in menyalin snapshot.
5. **Sentralisasi promo paket:** tambah `valid_until`, pertahankan predicate publik berbasis paket, dan sinkronkan public view/cache; pertahankan harga nominal dan resolver paket. Jangan menambah flag publik promo paket terpisah sebelum kebijakannya disetujui. Pindahkan editor dari `katalog/list.tsx` dan `katalog/package.tsx` setelah halaman pusat tersedia.
6. **Loyalty + preview:** read-only preview Walk-in menghitung completed rental dan nominal rekomendasi dari subtotal rental setelah promo baris.
7. **Promo Checkout nominal:** policy per usaha, permission apply/override, reason, `penyewaan_diskon`, dan header snapshot; UI nominal Rupiah.
8. **Mixed checkout:** update dua RPC mixed (draft dan activate) agar memakai pricing/discount helper yang sama; update checkout constraints dengan backfill terlebih dahulu.
9. **Finance/public read models:** menampilkan gross/promo/net; public views hanya field promo yang eksplisit public, ditambah invalidasi cache website.
10. **Hardening dan E2E:** RLS/grants, idempotency hash, concurrency overlap, security/performance advisors, database tests, browser desktop/mobile, reservasi ke Walk-in, POS, mixed checkout, refund/cancellation edge cases.

Migration harus backward-compatible, dapat direkonsiliasi, dan tidak menghapus histori. Perubahan constraint dilakukan setelah backfill dan query pembuktian bahwa semua row historis memenuhi formula baru.

---

## 7. Risiko dan keputusan yang belum ditutup

| Topik | Status | Catatan / keputusan yang dibutuhkan sebelum coding terkait |
|---|---|---|
| Role/capability storage | Perlu verifikasi desain final | Tiga capability sudah disetujui. Belum ada role-management UI atau role per membership. Pilih apakah grant dipetakan ke role global yang sudah ada atau membership per usaha. Rekomendasi: evaluasi capability pada konteks membership dan default-deny. |
| Batas diskon manual per usaha | Sebagian dibekukan | Input dan snapshot nominal; batas absolut 100% subtotal rental. Jika ada batas bisnis yang lebih rendah, simpan sebagai batas nominal Rupiah. Nilai default per usaha perlu ditentukan sebelum tombol manual diaktifkan. |
| 100% pada promo sale | Perlu verifikasi | Constraint retail saat ini menolak harga/subtotal/total 0. Apakah promo katalog sale boleh menghasilkan barang gratis? Jika ya, perlu kontrak zero-price retail dan no-payment. Jika tidak, channel sale harus mempunyai batas di bawah 100%. |
| Perubahan kesepakatan reservasi saat datang | Perlu verifikasi perilaku Walk-in | Saat ini Walk-in memuat snapshot dan mengunci picker item untuk reservation flow. Bila admin boleh mengubah item/harga setelah kesepakatan berubah, buat amendment eksplisit dan audit; jangan recalculate promo otomatis. |
| Pengelolaan izin per admin | Perlu desain UI | Repo saat ini belum menemukan UI mengelola permission anggota. Lokasi/flow untuk menetapkan tiga capability perlu ditetapkan bersama model penyimpanan. |
| Multiple scheduled package promos | Perlu keputusan operasional | Index unik saat ini hanya mengizinkan satu row `active` per tarif, termasuk row future-scheduled. Untuk menyimpan beberapa window non-overlap sekaligus, ganti dengan overlap guard berbasis waktu dan lock. |
| Public visibility untuk varian | Perlu verifikasi skema master | Barang memiliki `is_public`; hasil audit `varian_barang` tidak menunjukkan kolom `is_public`. Tentukan apakah visibilitas varian mengikuti induk atau perlu flag sendiri. |

---

## 8. Validasi Phase 0 dan batas perubahan

Pemeriksaan yang berhasil dilakukan:

- Baseline ARD yang diunggah identik byte-for-byte dengan `docs/architecture/ARD-001-event-promotions.md` di repository (SHA-256: `7e6ca56b54b1e4fad9f5f4ca48490d16c03b511c4cc8221d4ff14fc01c056fa8`).
- Branch aktif dan kondisi worktree diperiksa; terdapat banyak pekerjaan rental/retail lain yang belum di-commit.
- Supabase function signatures, security-definer/invoker status, execute ACL, schema tabel, constraints, RLS policies, table grants, triggers, dan public views diperiksa secara read-only.
- Consumer Katalog, Walk-in, Reservasi, POS, retail checkout, dan website katalog ditelusuri di repository.
- Migration remote terbaru diverifikasi sampai `20261105022844`.

**Tidak dilakukan pada Phase 0:**
- Tidak ada perubahan kode aplikasi.
- Tidak ada perubahan SQL/schema/function/trigger/policy/grant.
- Tidak ada migration baru atau migration yang diterapkan.
- Tidak ada transaksi uji yang membuat data bisnis.
- Tidak ada staging, commit, push, atau deployment.

---

## 9. Gate sebelum Phase 1

Phase 0 dinyatakan selesai sebagai audit dan pembekuan kontrak tingkat domain. Sebelum implementasi migration/Phase 1, mohon verifikasi empat butir yang masih membutuhkan keputusan eksplisit:

1. Apakah promo katalog channel **sale** boleh memberi diskon 100% sampai harga efektif nol, atau 100% hanya untuk rental/checkout?
2. Jika pelanggan datang melalui reservasi dan kesepakatan berubah, apakah admin boleh mengubah item/harga pada Walk-in melalui amendment yang tercatat?
3. Apakah hak admin akan diberikan berdasarkan role global yang sudah ada, atau berdasarkan capability per keanggotaan usaha? Rekomendasi arsitektur: capability per usaha.
4. Apakah diperlukan lebih dari satu promo paket terjadwal (periode non-overlap) pada satu tarif sekaligus, atau satu konfigurasi promo aktif/terjadwal per tarif sudah cukup?

Setelah empat keputusan tersebut diverifikasi, Phase 1 dapat dimulai dengan permission boundary dan promo katalog tanpa menyentuh modul retail/rental di luar jalur yang terinventarisasi.
