# Browser Verification / Playwright

Shared browser-verification capability untuk Rental Admin.

## Source of truth

Agent yang ingin melakukan visual/interaktif verification wajib membaca:

```text
AGENT-PLAYWRIGHT.md
scripts/browser-verify/README.md
```

Foundation project juga mensyaratkan browser verification dan inspeksi render aktual.

## Runtime

```text
SentinelX
  -> Chromium Headless Shell
  -> CDP
  -> Playwright 1.63.x
  -> localhost app
  -> screenshot + trace + JSON report
```

Runner sengaja memakai CDP karena browser binary standar pada host SentinelX tidak stabil; Chromium Headless Shell yang tersedia di host sudah terverifikasi.

## Authentication

Default:

```text
--auth=auto
```

Urutan sumber:

```text
VISUAL_STORAGE_STATE
  ↓
VISUAL_AUTH_EMAIL + VISUAL_AUTH_PASSWORD
  ↓
tanpa auth
```

Credential dapat dibaca dari environment host atau secret file. Runner tidak pernah menulis credential ke repository, report, trace, atau SentinelX context.

### Secret file

Lokasi yang didukung:

```text
VISUAL_AUTH_ENV_FILE
<repo>/.config/rental-outdoor/visual-verify.env
<repo-parent>/.config/rental-outdoor/visual-verify.env
$HOME/.config/rental-outdoor/visual-verify.env
/home/arch-din1/.config/rental-outdoor/visual-verify.env
/home/sentinelx/.config/rental-outdoor/visual-verify.env
```

Format:

```dotenv
VISUAL_AUTH_EMAIL=...
VISUAL_AUTH_PASSWORD=...
```

Permission harus:

```text
600
```

Jika file tidak ditemukan, `--auth=auto` jatuh ke unauthenticated verification dan tidak mengarang credential.

## Environment

```text
VISUAL_BASE_URL
VISUAL_BROWSER_PATH
VISUAL_AUTH_ENV_FILE
VISUAL_AUTH_EMAIL
VISUAL_AUTH_PASSWORD
VISUAL_STORAGE_STATE
VISUAL_ARTIFACT_DIR
VISUAL_TIMEOUT_MS
VISUAL_NAVIGATION_TIMEOUT_MS
VISUAL_TRACE
VISUAL_COLOR_SCHEME
```

## Commands

Runtime/configuration health check:

```bash
pnpm visual:doctor
```

Public/unauthenticated boundary check:

```bash
pnpm visual:verify -- --scenario=penyewa --path=/penyewa --auth=none
```

Authenticated automatic mode:

```bash
pnpm visual:verify -- --scenario=penyewa --path=/penyewa
```

Forced credentials:

```bash
pnpm visual:verify -- --scenario=penyewa --path=/penyewa --auth=credentials
```

Forced storage state:

```bash
VISUAL_STORAGE_STATE=/secure/path/state.json pnpm visual:verify -- --scenario=penyewa --path=/penyewa --auth=storage-state
```

Viewport:

```text
320x720
375x812
390x844
430x932
768x1024
1280x800
```

Trace:

```text
--trace=off
--trace=retain-on-failure
--trace=on
```

Artifacts:

```text
.visual-verify/
  *.png
  *.zip
  *.json
```

Artifact directory is ignored by git.

## Scope rule

Runner generic dapat membuka route modul apa pun melalui `--path`, tetapi hanya scenario yang memang tersedia yang boleh dieksekusi. Saat foundation ini hanya scenario `penyewa` yang diverifikasi.

Jangan membuat scenario modul lain hanya untuk memperluas test tanpa mission eksplisit.

## Execution host

Canonical agent verification berjalan melalui SentinelX, bukan browser lokal developer.

Chromium Headless Shell pada host SentinelX sudah terverifikasi dan tidak perlu diunduh ulang ke laptop hanya untuk visual verification.

Contoh eksekusi langsung pada SentinelX:

```bash
cd /home/arch-din1/PROJECT-SYSTEM/rental-outdoor/rental-admin
node scripts/browser-verify/doctor.mjs
node scripts/browser-verify/runner.mjs --scenario=penyewa --path=/penyewa
```

`pnpm visual:doctor` dan script `pnpm` lain tetap dapat digunakan dari workstation yang memiliki pnpm, tetapi ketiadaan pnpm/browser pada host SentinelX tidak boleh diperbaiki dengan menginstal browser kedua di workstation ketika SentinelX canonical runtime tersedia.
