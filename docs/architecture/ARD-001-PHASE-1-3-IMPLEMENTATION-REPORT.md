# ARD-001 — Implementation Report Phase 1–3

**Tanggal:** 5 November 2026
**Repository:** `rental-admin/`
**Branch:** `feat/unified-retail-sales-checkout`
**Status:** Implementasi backend/database Phase 1–3 selesai pada migration source dan lulus kompilasi PostgreSQL lokal terisolasi. Belum diaplikasikan ke Supabase produksi.

## 1. Cakupan implementasi

Batch ini mengikuti urutan teknis yang disepakati terakhir: fondasi permission dan promo → resolver harga → loyalty, checkout, dan integrasi transaksi. UI Event & Promosi/Walk-in tetap ditahan untuk Phase 4.

### Phase 1 — Permission dan fondasi promosi

- Capability disimpan per keanggotaan usaha dengan default-deny: `event_promotion.manage`, `checkout_discount.apply`, `checkout_discount.override`, `retail_bonus.apply`, `access_control.manage`, dan `reservation.amend`.
- Super-admin aktif mendapat grant eksplisit melalui backfill dan provisioning ketika keanggotaan super-admin baru diaktifkan. Pemeriksaan runtime tetap membaca grant per-usaha, bukan mengandalkan role global.
- Perubahan permission menggunakan trusted command, idempotency, audit log, dan perlindungan agar selalu ada pengelola akses aktif.
- Tabel `promosi_katalog` mendukung target barang atau varian (tepat satu), channel rental/sale terpisah, jadwal, `valid_until`, status draft/active/ended/cancelled, dan visibilitas internal/public yang default-nya internal.
- Snapshot promo katalog ditambahkan ke detail rental, reservasi, dan penjualan. Snapshot durasi tarif ditambahkan pada detail rental/reservasi agar konversi tidak bergantung pada tarif yang berubah kemudian.
- `promosi_paket_sewa.valid_until` ditambahkan tanpa mengganti model harga nominal promo paket yang sudah ada.

### Phase 2 — Resolver harga dan lifecycle promo

- Resolver server menerapkan prioritas promo varian → promo barang; tidak menumpuk dua promo.
- Channel rental dan sale tidak saling memengaruhi.
- Create, edit draft, activate, cancel, dan end promo mempunyai validasi jadwal, overlap guard berbasis lock tenant, optimistic concurrency, idempotency, audit, dan wrapper RPC.
- Promo paket mematuhi interval `[started_at, valid_until)` dan masa berlaku tarif.
- Trusted rental command menghitung harga promo rental dan menyimpan snapshot normal/effective/discount/duration.
- Trusted retail sale command memakai harga jual normal/varian, menerapkan promo sale di server, dan mempertahankan jalur HPP serta inventory. Promo sale yang membulat menjadi Rp0 ditolak; barang gratis tetap hanya melalui jalur bonus retail mixed checkout.

### Phase 3 — Loyalty, diskon rental, mixed checkout, dan bonus retail

- Program loyalitas per usaha memakai Model A: setelah threshold tercapai, kelayakan tetap aktif selama program berada dalam periode aktif.
- Hitungan berasal dari satu row `penyewaan` berstatus completed dengan `actual_return_completed_at IS NOT NULL`; transaksi sale dan jumlah detail tidak menambah hitungan.
- Rekomendasi loyalitas dikonversi menjadi nominal Rupiah. Diskon manual juga nominal, memerlukan alasan, dan tidak menghasilkan transaksi keuangan. Hak override hanya diperlukan ketika pelanggan eligible dan nominal aktual melampaui rekomendasi yang diperoleh.
- Header rental menyimpan subtotal, diskon, dan total net. Checkout menggunakan formula `subtotal_rental - discount_rental_amount + subtotal_penjualan`.
- Trusted RPC tersedia untuk direct rental, mixed checkout, activation, dan konversi reservasi dengan intent diskon yang sama.
- Konversi reservasi menyalin snapshot promo dan harga yang disepakati, tidak mengevaluasi promo terkini lagi. Harga per periode dikalikan dengan durasi aktual yang disetujui pada Walk-in.
- Bonus retail nol hanya dapat dibuat oleh trusted mixed-checkout path, membutuhkan capability tersendiri, alasan, dan hubungan checkout ke rental. Stok tetap dikonsumsi; HPP bonus dicatat terpisah dari HPP/laba kotor retail normal.
- Finance retail analysis mengecualikan baris bonus dari omzet/laba retail normal dan menyediakan metrik biaya bonus terpisah.

## 2. Migration files

| Migration | Isi utama | Baris |
|---|---|---:|
| `20261105045724_event_promotion_phase1_permissions_catalog_foundation.sql` | Permission membership, promo katalog, snapshot harga/durasi, package `valid_until` | 551 |
| `20261105045732_event_promotion_phase2_catalog_pricing_resolvers.sql` | Resolver, lifecycle promo, validator rental, direct rental/reservation/POS pricing | 3.395 |
| `20261105045739_event_promotion_phase3_loyalty_checkout_reservation.sql` | Loyalty, diskon checkout, mixed checkout, bonus retail, finance read model | 2.714 |

Total: **6.660 baris SQL**.

## 3. Hasil validasi

Pengujian dijalankan pada PostgreSQL lokal terisolasi melalui SentinelX. Database uji memakai struktur/tabel dan dependency stub yang mengikuti kontrak schema aktual; ini bukan pengujian terhadap data bisnis produksi.

| Area uji | Hasil |
|---|---|
| Ketiga migration dijalankan berurutan dengan `ON_ERROR_STOP=1` pada database uji bersih | **PASS** |
| Provisioning permission super-admin dan default-deny untuk admin biasa | **PASS** |
| ACL core sale/bonus internal tidak dapat dieksekusi langsung oleh anon/authenticated | **PASS** |
| Promo katalog: varian mengalahkan induk, fallback induk, isolasi channel, overlap, draft/schedule/activation | **PASS** |
| Promo paket: `valid_until` dan masa berlaku tarif | **PASS** |
| Direct rental: harga promo dan snapshot durasi/harga | **PASS** |
| Reservasi → rental: snapshot promo dipertahankan dan nilai per periode disesuaikan dengan durasi akhir | **PASS** |
| POS sale: promo sale, snapshot, HPP, laba kotor, dan konsumsi unit serialized | **PASS** |
| Loyalty Model A: threshold dan hitungan completed rental dengan actual return | **PASS** pada pengujian perilaku sebelumnya |
| Diskon checkout: nominal net, bonus override, alasan, dan tidak membuat pembayaran/arus kas | **PASS** pada pengujian perilaku sebelumnya |
| Bonus retail mixed: harga/subtotal nol, stok berkurang, HPP bonus terpisah, tanpa payment/ledger nol | **PASS** |
| Mixed checkout end-to-end: rental diskon 100% + retail bonus menghasilkan total Rp0, status paid karena kewajiban nol, tanpa pembayaran fiktif | **PASS** |

Kompilasi terakhir dilakukan kembali setelah hardening ACL dan provisioning permission. Perubahan terakhir pada jalur manual discount mempertahankan aturan: pelanggan non-eligible menggunakan capability apply untuk diskon manual; capability override diwajibkan saat nominal melampaui rekomendasi loyalitas yang memang diperoleh.

## 4. Batas yang sengaja belum dikerjakan

- Halaman Event & Promosi, editor promo paket terpusat, preview loyalty pada Walk-in, tombol Pakai Promo, input diskon, dan toggle bonus retail belum disentuh. Ini bagian Phase 4.
- Public website/read model promo tidak diaktifkan.
- Flow UI amendment item/harga reservasi belum dihubungkan. Konversi yang ada tetap mempertahankan snapshot reservasi dan tidak melakukan repricing diam-diam.
- Belum ada commit, push, atau deployment.

## 5. Status Supabase produksi

Tidak ada migration yang diaplikasikan ke project Supabase produksi. Pemeriksaan read-only terakhir menunjukkan tabel/kolom baru Phase 1–3 belum ada di schema remote. Ini disengaja agar implementasi dapat direview sebelum perubahan database produksi.

Migration source siap untuk review dan langkah berikutnya adalah Phase 4 setelah kontrak backend ini disetujui.
