# ADR-023 — Return Loss Mengunci Physical Unit ke Status Hilang

Status: ACCEPTED
Tanggal: 2026-10-05
Scope: Pengembalian + Pemeriksaan + Inventaris + Operational Workspace
Supersedes: tidak ada

## Konteks

Jalur return dapat menghasilkan Pemeriksaan dengan:

- `hasil = issue_found`
- `keputusan_operasional = unavailable`
- `temuan = loss`

Sebelum guard ini, pemeriksaan selesai tetapi `unit_barang.status` dapat tertinggal pada `inspection_pending`. Kondisi tersebut benar-benar terjadi pada fixture `CARRIER-EIGER-005`.

Masalahnya bukan bahwa unit harus masuk Perawatan. Kehilangan adalah fakta physical inventory yang berbeda dari kerusakan/perawatan. Namun state Inventaris harus tetap konvergen agar unit tidak tampak masih menunggu Pemeriksaan setelah Pemeriksaan selesai.

## Keputusan

1. Jika Pemeriksaan return memiliki finding `loss` dan keputusan operasional `unavailable`, database secara atomik menandai unit fisik menjadi `lost`.
2. Guard berada di boundary database pada `temuan_pemeriksaan`, sehingga jalur trusted command alternatif tetap mendapat perlindungan yang sama.
3. Guard hanya melakukan transisi otomatis dari `inspection_pending` ke `lost`. Jika unit sudah `lost`, tindakan idempoten; jika status lain, guard melakukan defer dan tidak memaksa overwrite.
4. Unit `rented` ditolak sebagai kondisi konflik agar fakta possession tidak dapat diputus dari jalur yang salah.
5. Tidak ada Perawatan otomatis untuk loss. Loss tetap menjadi fakta Inventaris dan dapat menghasilkan Potensi Tanggungan Penyewa melalui Finance.
6. Audit log, riwayat unit, dan outbox event dicatat untuk transition otomatis.
7. Operational workspace menggunakan `lost` sebagai readiness state tersendiri.
8. Mutation response dan read contract sama-sama menggunakan `lost`, sehingga frontend tidak perlu menerjemahkan `blocked` sebagai loss.
9. Data lama yang sudah telanjur berada pada kombinasi `loss + unavailable + inspection_pending` direkonsiliasi saat migration.

## Boundary

```text
Pemeriksaan
  finding = loss
        ↓
Inventory physical truth
  status = lost
        ↓
Finance
  consequence review bila relevan
```

Tidak ada:

```text
loss → maintenance
loss → ready
loss → payment otomatis
```

## Reliability

Guard harus:

- idempotent;
- tenant-scoped;
- audited;
- historis;
- fail-closed terhadap `rented`;
- tidak menghapus unit;
- tidak membuat duplicate maintenance.

## Acceptance

- CARRIER-EIGER-005 menjadi `lost`.
- Riwayat mencatat `inspection_pending → lost`.
- Audit dan outbox memiliki event transition.
- Perawatan tetap 0 untuk loss.
- Operational read contract mengembalikan readiness `lost`.
- Operational command response mengembalikan readiness `lost`.
- UI Pemeriksaan tidak lagi mengatakan loss masuk Perawatan.
- UI Rental Operational Workspace menampilkan Hilang dan tidak menampilkan tombol/tautan Perawatan untuk loss.
- Unit Hilang tidak tersedia untuk rental baru.
