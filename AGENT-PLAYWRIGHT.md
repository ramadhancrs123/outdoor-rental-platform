# AGENT-PLAYWRIGHT.md

## Purpose

Ini adalah operational contract untuk agent yang melakukan browser/visual verification pada Rental Admin.

## Canonical workspace

```text
/home/arch-din1/PROJECT-SYSTEM/rental-outdoor/rental-admin/
```

## Required runtime

```text
Playwright 1.63.x
Chromium Headless Shell
SentinelX
CDP
```

Jangan mengganti browser runtime secara sepihak bila runtime canonical masih tersedia.

## Required flow

```text
read docs
→ inspect current state
→ start/verify local app
→ run scenario
→ inspect screenshot
→ inspect diagnostics
→ inspect trace if needed
→ report evidence
```

Browser evidence tidak menggantikan backend/business verification.

## Authentication contract

Jangan meminta credential masuk source code.

Gunakan:

```text
--auth=auto
```

Runner mencari credential dari host environment/secret file:

```text
VISUAL_AUTH_EMAIL
VISUAL_AUTH_PASSWORD
```

Secret file:

```text
~/.config/rental-outdoor/visual-verify.env
```

Alternatif path dapat diberikan lewat:

```text
VISUAL_AUTH_ENV_FILE
```

Jangan menulis isi secret ke log, report, screenshot, trace description, git, atau project documentation.

Secret file harus permission 600.

## Browser configuration

Runner:

```text
scripts/browser-verify/runner.mjs
```

Scenario:

```text
scripts/browser-verify/scenarios/<scenario>.mjs
```

Run generic:

```bash
pnpm visual:verify -- --scenario=<scenario> --path=<route>
```

Default auth adalah `auto`.

Explicit unauthenticated check:

```bash
pnpm visual:verify -- --scenario=<scenario> --path=<route> --auth=none
```

## Artifacts

Artifact lokal:

```text
.visual-verify/
```

Jangan commit artifact.

Setiap run dapat menghasilkan:

```text
PNG screenshot
JSON report
Playwright trace ZIP
```

## Viewports

Foundation minimum:

```text
320x720
375x812
390x844
430x932
768x1024
1280x800
```

## Diagnostics

Runner mengumpulkan:

```text
consoleErrors
pageErrors
httpErrors
requestFailures
finalURL
screenshot list
trace
```

Telemetry Refine yang gagal karena endpoint telemetry tidak dihitung sebagai application request failure.

## Scenario design

Scenario harus menggunakan interaksi user nyata:

```text
getByRole
getByLabel
getByText
locator
click
fill
select
waitFor
```

Jangan memanggil internal React state atau menyuntikkan business state ke DOM.

Untuk transaction flow:

```text
click/submit
→ tunggu trusted backend result
→ observe revalidation
→ capture
```

Unknown outcome:

```text
reconcile
→ capture actual state
```

Jangan menganggap timeout sebagai success.

## Scope

Runner generic boleh mengakses route modul apa pun, tetapi scenario yang dieksekusi harus disebutkan secara eksplisit dalam mission.

Jangan menguji semua modul hanya karena runner dapat mengaksesnya.

## Current verified scenario

Saat dokumen ini dibuat:

```text
Penyewa
```

Scenario ini mencakup:

```text
list
search no-result
clear search
detail
Ringkasan
Identitas
Kontak
Operasional
```

Execution status setiap run harus tetap dibedakan:

```text
VERIFIED
BLOCKED_AUTH
FAILED
```

Jangan menyamakan `BLOCKED_AUTH` dengan `VERIFIED`.

## Execution host contract

Browser installation di Arch Linux developer host bersifat opsional. Browser canonical untuk verification agent adalah Chromium Headless Shell yang tersedia pada host SentinelX.

Jangan menjalankan `playwright install chromium` hanya untuk membuat local browser tersedia bila verification akan dieksekusi melalui SentinelX.

Pada SentinelX, runner dapat dieksekusi langsung dengan:

```bash
node scripts/browser-verify/runner.mjs --scenario=<scenario> --path=<route>
```

`pnpm` tidak disyaratkan pada host SentinelX.

Health check harus dijalankan pada host yang benar-benar menjadi execution target. `visual:doctor` pada workstation lokal boleh melaporkan browser lokal `MISSING` tanpa berarti SentinelX belum siap.
