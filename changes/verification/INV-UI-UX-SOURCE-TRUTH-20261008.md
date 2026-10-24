# Investor UI/UX Source of Truth — 2026-10-08

Status: VERIFIED WITH EVIDENCE  
Reference visual: conversation attachment `1000536197.png` (the approved multi-screen Investor UI/UX board)

## Scope

This visual source defines the presentation contract for:

### Mobile
1. Ringkasan
2. Performa
3. Transaksi
4. Akun
5. Konfigurasi Investor on Keuangan navigation

### Desktop
6. Ringkasan
7. Performa
8. Akun & Distribusi

## Information architecture

Mobile Investor uses four primary tabs:

- Ringkasan
- Performa
- Transaksi
- Akun

The mobile summary prioritizes:
1. Partisipasi Investor
2. Estimasi Hak Investor Berjalan
3. Pemasukan / Pengeluaran / Hasil Bersih
4. Mengapa Berubah?
5. Aktivitas Terbaru

The performance tab owns the data-heavy visualizations so the summary does not become a long chart-heavy scroll.

The configuration screen is owned by Keuangan at:
`/keuangan/investor`

The configuration mobile navigation follows the Finance shell vocabulary:
Beranda / Pembayaran / Pengeluaran / Transaksi / Konfigurasi.

## Visual hierarchy

- Investor percentage and current investor entitlement are primary visual blocks, not tiny KPI cards.
- Operational KPIs remain secondary.
- Financial charts are grouped under Performa.
- Transactions use mobile list/card presentation rather than forcing a desktop table onto a narrow viewport.
- Account information is separated from entitlement calculation.
- Live/freshness state is visible but must not dominate the business values.
- Stale/review-required/config-required states remain semantically distinct.

## Semantic display constraints

The UI must consume the verified Investor frontend contract and backend truth.

Required distinctions:
- OPEN vs CLOSED
- fresh vs stale
- multi-currency review required vs numeric zero
- configuration missing vs zero values
- allocation vs distribution
- operational cash vs investor entitlement

Canonical calculation display:

`Net Operational Result = recorded income - recorded expense`

`Open Investor Estimate = MAX(Net Operational Result, 0) × Investor Percentage`

Open period copy should use:
`Estimasi Hak Investor Berjalan`

Closed period can present final allocation semantics.

## Prohibited visual shortcuts

Do not hard-code values from the reference mockup.

Do not invent:
- fixed `15% / 65% / 20%` distribution splits
- ±10% forecast scenarios
- investor/operator balances
- distribution history
- stakeholder account balances
- fake allocation or distribution records

Reference image values are presentation exemplars, not data fixtures.

When backend evidence is unavailable, the UI must show unavailable/empty state instead of fabricated values.

## Responsive acceptance

Minimum verification targets:
- 320×720
- 375×812
- 390×844
- 430×932
- 768×1024
- 1280×800

Core mobile invariants:
- no horizontal overflow
- tabs remain reachable
- bottom navigation remains usable
- charts remain legible
- important values remain above decorative analytics
- transactions use compact list/card layout
- configuration actions remain reachable without zooming

## Browser verification evidence

Investor dashboard scenario:
- 390×844: VERIFIED
- 1280×800: VERIFIED
- Captured: summary, performance, transactions, accounts

Investor configuration scenario:
- 390×844: VERIFIED
- No console/page/request errors after using the verified participation-history fallback for current configuration display.

## Current environment/data limitations

The visual runner currently reports HTTP 403 for:
`finance_operational_account_summary`

Therefore the Account tab must not fabricate operational account balances.

The historical distribution dataset is not currently exposed by the Investor frontend service contract used in this UI wave. Therefore the performance visual uses actual recorded investor impact from financial activity rather than inventing a distribution-history series.

These are data/evidence constraints, not visual design regressions.

## Verification commands

- `./node_modules/.bin/tsc --noEmit` — PASS
- Focused Investor ESLint — PASS
- `./node_modules/.bin/vitest run src/tests/investor.contract.test.ts` — 7/7 PASS
- `git diff --check` — PASS
- Browser visual scenarios — PASS
- Initial `refine build` attempt was blocked by SentinelX environment permission for Refine's update notifier directory. A subsequent build must set an isolated HOME/XDG config directory before claiming production build evidence.

## Source-of-truth rule

Future Investor UI work must treat this document plus the approved reference image as the visual baseline.

Business semantics remain owned by Investor/Finance source-of-truth documents, ADRs, backend contracts, and the frontend UI contract. Visual fidelity must not override those semantics.
