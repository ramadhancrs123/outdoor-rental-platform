# ADR-016 — Maintenance Queue Current Cycle & Verification Trace

**Status:** Accepted  
**Tanggal:** 2026-10-03  
**Scope:** Perawatan + Pemeriksaan + Inventaris

## Context

Satu unit fisik dapat memiliki lebih dari satu record perawatan sepanjang lifecycle-nya. Karena itu, status unit saat ini tidak boleh dipakai sendirian untuk memberi label pada semua record maintenance historis.

Kasus `Carr-cr-40L` membuktikan masalah:

- maintenance lama `795f1b60...` berstatus `completed`;
- maintenance lama tersebut sudah memiliki event `maintenance_verification_passed`;
- unit kemudian dipakai kembali, dikembalikan, diperiksa, dan memperoleh maintenance baru `88b8cced...` berstatus `planned`;
- filter lama membaca `completed + unit_status=maintenance` lalu salah menampilkan maintenance lama sebagai `Menunggu Verifikasi`.

## Decision

1. Queue `Perlu Tindakan` hanya mempertimbangkan:
   - maintenance `planned`;
   - maintenance `in_progress`;
   - maintenance `completed` yang merupakan maintenance terbaru untuk unit, unit masih `maintenance`, dan belum memiliki verification pass.
2. Verification status maintenance ditentukan dari `riwayat_unit` yang memiliki:
   - `sumber_type = 'perawatan'`;
   - `sumber_id = perawatan_id`;
   - event `maintenance_verification_passed` atau `maintenance_verification_failed`.
3. Record maintenance yang sudah pernah lulus verification tidak boleh kembali muncul sebagai `Menunggu Verifikasi` hanya karena unit yang sama sedang menjalani lifecycle baru.
4. Detail maintenance completed yang sudah lulus tidak menampilkan tombol Verifikasi Lulus lagi. Detail menjelaskan bahwa record tersebut historis/terverifikasi dan status fisik unit saat ini mengikuti siklus terbaru.
5. Database mencegah pembuatan maintenance `planned` baru apabila unit masih memiliki maintenance `completed` yang belum memiliki verification pass dan unit masih berada pada state `maintenance`.
6. Reconciliation command mencakup `verify_maintenance_readiness`, sehingga unknown outcome verification dapat benar-benar direkonsiliasi.

## Verification

State `Carr-cr-40L` saat investigasi:

- maintenance lama `795f1b60...` → `completed`, verification `passed`, bukan latest;
- maintenance baru `88b8cced...` → `planned`, latest;
- active queue hasil klasifikasi canonical → **7**;
- lint target → PASS;
- `perawatan.service.test.ts` → **11/11 PASS**;
- trigger duplicate-pending-verification aktif di database;
- unit physical truth tetap mengikuti Inventaris.
