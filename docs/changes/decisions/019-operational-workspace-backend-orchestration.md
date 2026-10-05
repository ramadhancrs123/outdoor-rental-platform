# ADR-019 — Operational Workspace Backend Orchestration dan Readiness Parsial

Status: ACCEPTED
Tanggal: 2026-10-05
Supersedes: aturan "setiap pemeriksaan return wajib membuat Perawatan" pada ADR-010.
Scope: BACKEND / BUSINESS WORKFLOW / RELIABILITY

## Konteks

Kebutuhan operasional mengharuskan admin menyelesaikan pekerjaan rental melalui workspace operasional yang ringkas. Backend tetap mempertahankan ownership canonical pada Penyewaan, Pengembalian, Pemeriksaan, Perawatan, Inventaris, dan Keuangan.

ADR-010 sebelumnya mewajibkan setiap pemeriksaan return membuat Perawatan, termasuk hasil normal. Dalam alur operasional baru, aturan tersebut menghasilkan pekerjaan semu dan menghalangi jalur normal kembali ke READY.

## Keputusan

### 1. Orchestration bukan domain baru

Backend menyediakan trusted orchestration command yang hanya mengorkestrasi command-domain canonical.

Ownership tidak berpindah:

Penyewaan → rental, schedule, assignment, handover
Pengembalian → actual return
Pemeriksaan → condition/finding
Perawatan → maintenance work
Inventaris → physical readiness
Keuangan → money truth

### 2. Rental activation

Golden command:

create/prepare rental
→ server pricing validation
→ availability revalidation
→ auto-assignment bila belum lengkap
→ handover
→ active

Auto-assignment wajib menghindari unit yang sudah ditetapkan pada rental yang sama.

Mutation harus idempotent, tenant-safe, transaction-safe, audited, dan retry-safe.

### 3. Return orchestration

Untuk satu unit:

receive return
→ start inspection
→ complete inspection
→ maintenance bila memang diperlukan
→ readiness verification bila memenuhi syarat
→ Inventory READY

Partial return tetap sah.

Rental dapat tetap berada pada status return_in_progress ketika sebagian unit masih berada pada penyewa, tetapi unit yang sudah benar-benar diterima dapat menyelesaikan readiness lifecycle-nya sendiri.

### 4. Maintenance hanya bila diperlukan

Inspection normal tidak otomatis membuat Perawatan.

Perawatan otomatis dibuat bila:
- keputusan operasional memerlukan cleaning/maintenance/follow-up; atau
- temuan menunjukkan damage, dirty, atau missing component.

Inspection normal dengan kelengkapan complete dan keputusan readiness yang valid dapat langsung diteruskan ke readiness review Inventaris.

Perawatan selesai tetap bukan bukti READY. Verifikasi readiness tetap wajib.

### 5. Unit readiness bersifat unit-scoped

Validator READY tidak boleh menganggap seluruh rental masih memiliki possession atas unit tertentu apabila unit tersebut sudah memiliki fakta actual return untuk rental yang sama.

Status rental return_in_progress tidak dengan sendirinya menghalangi unit yang sudah dikembalikan untuk menjadi READY.

### 6. Unknown outcome dan idempotency

Command orchestration menggunakan idempotency key dan mempertahankan boundary command-domain yang sudah ada.

Retry terhadap mutation tidak membuat return, inspection, maintenance, assignment, atau readiness ganda.

### 7. Read contracts

Backend menyediakan read contract khusus operational workspace agar frontend fase berikutnya tidak perlu membaca banyak tabel dan menciptakan business semantics sendiri.

Read contract hanya merupakan projection/read model; canonical facts tetap berada pada domain pemilik.

## Non-Goals

Keputusan ini tidak:
- menggabungkan tabel domain;
- menghapus modul Inspection atau Maintenance;
- menjadikan orchestration sebagai source of truth;
- memindahkan money truth ke Rental;
- mengubah pricing authority dari server;
- membuat status generic untuk shortcut UI.

## Acceptance

- Auto-assignment quantity >1 tidak pernah menetapkan unit fisik yang sama dua kali.
- Rental activation menghasilkan active rental hanya setelah assignment/handover valid.
- Partial return membuat rental tetap return_in_progress.
- Unit yang sudah returned dapat mencapai READY walaupun unit lain pada rental yang sama belum kembali.
- Inspection normal tidak membuat maintenance.
- Inspection dengan cleaning/damage/missing/follow-up membuat satu maintenance task.
- Maintenance completion belum membuat READY sebelum verification.
- Verification sukses menghasilkan READY.
- Idempotent retry mengembalikan response sebelumnya tanpa mutation ganda.
- Tenant yang tidak berwenang ditolak.
- Backend read contract tenant-scoped.
