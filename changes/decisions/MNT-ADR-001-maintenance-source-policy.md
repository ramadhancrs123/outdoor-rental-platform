# MNT-ADR-001 — Maintenance Source Policy

**Status:** FINAL / FASE AWAL
**Scope:** Master Control Session 1 — Perawatan
**Date:** 2026-09-28

## Decision

Maintenance tanpa pemeriksaan_id resmi diperbolehkan pada fase awal sebagai manual maintenance.

Aturannya:

1. Jika maintenance berasal dari Pemeriksaan, pemeriksaan_id wajib menjadi source trace.
2. Jika pemeriksaan_id kosong, alasan maintenance wajib dicatat pada field canonical perawatan.catatan.
3. Jalur tanpa Inspection Source hanya boleh dibuat dari unit berstatus ready pada trusted command saat ini.
4. Maintenance tanpa Inspection Source tetap masuk planned dan mengikuti lifecycle normal.
5. Completion maintenance tidak berarti unit READY; readiness tetap menjadi ownership Inventaris setelah verification.
6. Tidak ada field atau schema baru untuk reason pada fase ini. catatan menjalankan dua konteks:
   - catatan atau konteks umum bila ada Inspection Source;
   - alasan wajib bila tidak ada Inspection Source.

## Rationale

Dokumen 20-alur menyatakan maintenance dapat berasal dari inspection atau maintenance terjadwal future dan fase awal primarily inspection-driven. Kontrak perawatan juga menyatakan maintenance may link to inspection source. Karena source inspection tidak selalu tersedia untuk pekerjaan maintenance manual, source-less maintenance dibuka tetapi harus tetap explainable.

Reason tidak dibuat menjadi kolom baru karena database contract saat ini sudah menyediakan catatan pada perawatan, dan trusted command telah memiliki guard bahwa maintenance manual wajib memiliki alasan.

## Boundary

Tidak diperbolehkan:

- source-less maintenance tanpa alasan;
- membuat maintenance melalui generic status update;
- menganggap alasan sebagai payment justification;
- mengubah maintenance completion menjadi READY;
- mengarang source_type baru atau schema baru pada fase ini.

## Verification

Maintenance tanpa Inspection Source tidak menjadi dead-end setelah completion. Phase 1 menyediakan trusted command `command_verify_maintenance_readiness` yang dapat mencatat verification pass/fail dan, pada pass, menyerahkan final physical state kepada Inventaris untuk menjadi READY.

Jalur ini tidak membuat synthetic Inspection record hanya untuk membuka READY.

## Future Decision

Jika sistem nanti membutuhkan klasifikasi formal seperti preventive, scheduled, vendor-triggered, atau source type non-inspection lainnya sebagai data canonical yang dapat difilter atau dilaporkan, buat ADR atau schema decision baru sebelum menambah field atau enum.

## Verification

Current backend contract already enforces:

pemeriksaan_id kosong
→ catatan wajib
→ unit harus READY
→ maintenance dibuat sebagai PLANNED

Frontend service validation telah diselaraskan agar gagal sebelum RPC ketika alasan manual tidak ada.
