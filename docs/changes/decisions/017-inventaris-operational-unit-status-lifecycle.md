# ADR-017 — Status Operasional Unit Inventaris

**Status:** Accepted  
**Tanggal:** 2026-10-03  
**Scope:** Inventaris + Penyewaan + Perawatan

## Keputusan

Inventaris menyediakan tiga aksi operasional eksplisit pada unit fisik:

- **Rusak** — unit tidak boleh dipilih untuk penyewaan baru dan dapat ditindaklanjuti melalui Perawatan.
- **Hilang** — unit tidak boleh dipilih untuk penyewaan baru dan tetap tercatat sebagai physical history.
- **Dinonaktifkan** — unit tidak lagi dianggap siap disewakan dan tidak boleh muncul sebagai unit yang dapat dipilih untuk penyewaan baru.

Unit tidak boleh dihapus untuk menyelesaikan kondisi tersebut. Identitas unit dan histori tetap dipertahankan.

## Boundary

Katalog mengendalikan status penawaran barang/varian. Inventaris mengendalikan status physical unit. Menonaktifkan barang di Katalog tidak mengubah status physical unit secara otomatis.

Penyewaan hanya boleh menggunakan unit dengan status `ready` sebagai physical candidate. Karena itu, `damaged`, `lost`, dan `inactive` otomatis berada di luar pool unit yang dapat dipilih untuk rental baru.

Perubahan status unit saat sedang `rented` tidak dilakukan melalui aksi status umum Inventaris. Perubahan seperti kehilangan/kerusakan selama rental harus mengikuti workflow Penyewaan/Pengembalian agar histori possession tetap benar.

## Mutation Contract

Perubahan status dilakukan melalui trusted command:

`command_set_inventory_unit_operational_status`

Command:

- tenant-scoped;
- membutuhkan authorization admin;
- wajib memiliki alasan;
- menggunakan `expected_updated_at`;
- menggunakan idempotency;
- menggunakan locking;
- menulis `riwayat_unit`;
- menulis `audit_log`;
- menulis `outbox_event`;
- fail-closed bila unit sedang `rented`.

Reconciliation menggunakan `command_reconcile_inventory_unit_mutation`.

## UI

Detail unit menyediakan aksi **Ubah Status Unit** dengan pilihan:

`Rusak` / `Hilang` / `Dinonaktifkan`.

UI menjelaskan konsekuensi operasional kepada admin dan tidak menampilkan istilah backend.

## Verification

- Query rental ready-pool hanya mengambil `unit_barang.status = 'ready'`.
- Targeted Inventory ESLint: PASS.
- `inventaris.service.test.ts`: **10/10 PASS**.
- Live DB mengandung command dan reconciliation function.
- Tidak ada hard-delete unit.
- Status unit saat ini tidak diubah oleh deployment ini; perubahan hanya terjadi saat admin menjalankan aksi.