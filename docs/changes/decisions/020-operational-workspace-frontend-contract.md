# ADR-020 — Kontrak Frontend Operational Workspace Rental

Status: ACCEPTED
Tanggal: 2026-10-05
Scope: Fase 2 — frontend business logic dan contract layer. Tidak mencakup redesign visual Fase 3.

## 1. Tujuan

Frontend membentuk dua workspace operasional yang tetap sederhana bagi operator tanpa mengambil alih ownership domain.

1. Input Penyewaan: penyewa → periode → barang/paket → pricing → pembayaran → kebijakan/toleransi → persiapan unit → serah-terima.
2. Detail Penyewaan / Selesaikan Sewa: menerima unit → pemeriksaan → perawatan bila diperlukan → verifikasi readiness → unit kembali ke Inventaris READY.

Frontend hanya mengorkestrasi konteks dan command. Source of truth tetap berada pada command database/domain.

## 2. Kontrak Aktivasi Rental

Command utama untuk serah-terima/aktivasi adalah public.command_operational_activate_rental(...).

- auto-assignment adalah default server-side;
- penetapan manual tetap diperbolehkan sebagai exception sebelum aktivasi;
- pembayaran tidak mengaktifkan rental;
- actual pickup dan active hanya lahir dari command aktivasi;
- retry setelah hasil tidak pasti tidak boleh langsung dilakukan; frontend melakukan state re-read dan hanya menerima recovery bila rental sudah active dengan actual_pickup_at.

Frontend read contract: public.get_operational_rental_workspace(...).

## 3. Kontrak Toleransi dan Denda

Toleransi dan denda memiliki dua level.

### Kebijakan Usaha

RentalPolicyDialog menggunakan:
- default_tolerance_hours
- late_fee_enabled
- late_fee_per_hour

Kebijakan ini berlaku untuk rental baru. Rental yang sudah berjalan mempertahankan tolerance_deadline yang sudah tersnapshot.

### Per Rental

ToleranceExtensionDialog hanya memperpanjang tolerance_deadline; jadwal_kembali tidak berubah.

Denda:
- hanya dihitung setelah toleransi terlewati;
- denda berjalan adalah assessment/display, bukan payment;
- denda final setelah rental selesai dapat menjadi evaluasi_konsekuensi_penyewaan;
- frontend tidak boleh membuat payment otomatis dari keterlambatan.

## 4. Kontrak Return → Inspection → Maintenance → Ready

Command utama: public.command_operational_process_unit_return(...).

Input frontend harus menyediakan fakta pemeriksaan, bukan mengasumsikan normal secara diam-diam:
- hasil
- kelengkapan_status
- keputusan_operasional
- catatan
- findings

Satu command memproses satu unit. Multi-unit UI adalah batch sequential, bukan transaction atomik lintas unit.

State per unit:
rented → returned/inspection_pending → inspected → maintenance_required/blocked/ready → ready

Aturan penting:
- Return ≠ Ready.
- Inspection ≠ Ready.
- Maintenance ≠ Inspection.
- Unit hanya menjadi READY setelah server menyatakan readiness dapat dilakukan.
- Partial return diperbolehkan; unit yang sudah selesai dapat READY sementara unit lain masih berada pada rental.

Read contract: public.get_operational_return_workspace(...) menjadi sumber konteks detail per-unit, termasuk return, inspection, maintenance, dan readiness state.

## 5. Kontrak Keuangan

Konsekuensi finansial tetap milik Finance.

Trigger backend dapat membuat evaluasi_konsekuensi_penyewaan dengan status pending_review untuk:
- late_fee
- damage
- loss
- missing_component

Frontend membaca daftar tersebut melalui listRentalConsequenceReviews().

Review dilakukan melalui public.command_review_rental_consequence(...).

Hanya konsekuensi yang sudah approved yang boleh dipetakan ke pembayaran.

Karena baseline Finance menggunakan tipe pembayaran dp, pelunasan, dan pembayaran_tambahan, konsekuensi yang benar-benar dibayar dicatat sebagai jenis pembayaran_tambahan dan tetap terhubung ke penyewaan_id, akun keuangan, metode pembayaran, nominal, serta referensi evaluasi.

Tidak ada claim bahwa record_consequence_payment adalah command production. Backend saat ini memiliki reconcile_finance_command yang mengenal nama command tersebut, tetapi command pencatatan khusus itu belum tersedia. Contract layer menggunakan command pembayaran yang sudah VERIFIED: command_record_payment_with_account.

## 6. Error dan Idempotency

Frontend wajib:
- mengirim idempotency_key dan request_id;
- mempertahankan key selama satu mutation sampai hasil diketahui;
- tidak melakukan retry otomatis ketika outcome tidak pasti;
- melakukan read/reconciliation terhadap source-of-truth sebelum tindakan baru;
- menampilkan partial success bila batch multi-unit berhenti setelah sebagian unit berhasil.

## 7. Batas Fase

Fase 2 selesai pada:
- service contracts;
- typed command/query models;
- idempotency/error policy;
- Finance handoff contract;
- test contract layer.

Fase 3 belum termasuk:
- redesign visual;
- layout baru;
- styling baru;
- penyusunan ulang komponen UI;
- pola interaksi final untuk form pemeriksaan, temuan, evidence, perawatan, dan pembayaran konsekuensi.

## 8. Acceptance Criteria Fase 2

- Frontend activation memakai operational rental command.
- Return workspace memiliki contract untuk return → inspection → maintenance → readiness.
- Input inspection tidak boleh di-default diam-diam menjadi normal pada command operational.
- Partial return tetap aman.
- Toleransi tidak mengubah jadwal rental.
- Denda tidak otomatis menjadi payment.
- Approved consequence dapat dipetakan secara eksplisit ke pembayaran_tambahan.
- Tenant id tetap menjadi boundary setiap query/command.
