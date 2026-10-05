# Phase 3 — Rental Operational Workspace Verification

Status: VERIFIED FOR FEATURE SCOPE
Date: 2026-10-05

## Target

`Detail Penyewaan` menjadi pusat operational workspace untuk lifecycle rental. `Pengembalian` tidak lagi menjadi primary-navigation workspace; route legacy tetap dipertahankan untuk compatibility/deep-link. `Pemeriksaan` menjadi canonical domain record yang diorkestrasi dari workspace. `Perawatan` tetap menjadi tool modular untuk maintenance manual, queue, history, dan tindak lanjut.

## Critical Acceptance

Mixed partial return harus bersifat unit-scoped:

```text
Unit A → diterima → kondisi normal → READY
Unit B → diterima → rusak → Maintenance

READY Unit A tidak menunggu Unit B.
```

## Implementation

- `src/components/penyewaan/rental-operational-workspace.tsx` menampilkan state per unit dan meminta kondisi eksplisit sebelum mutation.
- Normal menghasilkan readiness per unit; rusak/kotor/komponen kurang menghasilkan follow-up Maintenance melalui command canonical.
- Tugas Maintenance yang dibuat tersedia sebagai entry point ke `/perawatan/:id`.
- `src/pages/penyewaan/show.tsx` menanamkan workspace ke Detail Penyewaan.
- Dashboard dan daftar Penyewaan mengarahkan aksi penyelesaian ke Detail Penyewaan.
- Primary sidebar tidak lagi memaksa `Pengembalian`; `Perawatan` tetap tersedia.
- `docs/changes/decisions/021-rental-detail-operational-workspace.md` merekam keputusan arsitektur.

## Verification Evidence

### Automated

- Full Vitest: **35 test files passed, 193 tests passed**.
- Targeted operational + rental tests: **2 files, 5 tests passed**.
- ESLint affected production/test/browser-scenario files: **PASS**.
- `git diff --check` affected scope: **PASS**.

### Browser

Browser scenario `scripts/browser-verify/scenarios/penyewaan-operational-workspace-mock.mjs` uses an isolated mock fixture because current dummy `public.penyewaan` is empty. This does not modify the database.

- Mobile `375x812`: **VERIFIED**.
- Desktop `1280x800`: **VERIFIED**.
- Both views showed the mixed state `2/2 kembali`, `1 Ready`, `1 Perawatan`.
- Browser diagnostics: no console errors, page errors, HTTP errors, or request failures.
- Visual capture: `.visual-verify/rental-operational-workspace-mixed-ready-maintenance-375x812.png` and desktop counterpart.

### Backend dependency evidence

Phase 1 backend verification already recorded:
- Partial return keeps rental `return_in_progress` while returned unit can become READY: PASS.
- Normal inspection creates no maintenance: PASS.
- Issue/dirty return creates one maintenance task: PASS.
- Readiness gate is unit-scoped and does not require unrelated units to be ready.

The new frontend test composes these semantics into the mixed UI state: one normal unit remains READY while another unit enters Maintenance.

## Global repository note

A repository-wide `tsc --noEmit` was attempted. It is **BLOCKED by unrelated pre-existing worktree file** `src/pages/katalog/package.tsx` (untracked), which currently has three `CreateCatalogPackageInput` status typing errors. This file was not created or modified in this scope and was not touched.

Therefore: **feature scope is VERIFIED; global repository typecheck is not currently clean because of an unrelated baseline blocker.**

## Safety / Delivery

- No database fixtures were added for verification.
- No production deployment.
- No commit.
- No push.
- No staging/promotion.
- Pre-existing dirty worktree changes were not reverted or staged.

## Final State

**VERIFIED — Rental Operational Workspace is implemented and verified for the requested Phase 3 scope.**
