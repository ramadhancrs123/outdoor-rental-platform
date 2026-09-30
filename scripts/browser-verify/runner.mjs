#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const ROOT = process.cwd();
const DEFAULT_SECRET_PATH = ".config/rental-outdoor/visual-verify.env";
const ARTIFACT_DIR = path.resolve(ROOT, process.env.VISUAL_ARTIFACT_DIR || ".visual-verify");
const BASE_URL = (process.env.VISUAL_BASE_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
const DEFAULT_TIMEOUT = Number(process.env.VISUAL_TIMEOUT_MS || 15000);
const DEFAULT_NAVIGATION_TIMEOUT = Number(process.env.VISUAL_NAVIGATION_TIMEOUT_MS || 30000);

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function slug(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function resolveViewport(value) {
  const presets = {
    "320x720": { width: 320, height: 720, isMobile: true },
    "375x812": { width: 375, height: 812, isMobile: true },
    "390x844": { width: 390, height: 844, isMobile: true },
    "430x932": { width: 430, height: 932, isMobile: true },
    "768x1024": { width: 768, height: 1024, isMobile: true },
    "1280x800": { width: 1280, height: 800, isMobile: false },
  };
  if (!value) return presets["1280x800"];
  if (presets[value]) return presets[value];
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) throw new Error(`Viewport tidak valid: ${value}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  return { width, height, isMobile: width <= 768 };
}

function parseEnvFile(filePath) {
  const values = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function secretCandidates() {
  const candidates = [
    process.env.VISUAL_AUTH_ENV_FILE,
    path.resolve(ROOT, DEFAULT_SECRET_PATH),
    path.resolve(ROOT, "..", DEFAULT_SECRET_PATH),
    path.resolve(os.homedir(), DEFAULT_SECRET_PATH),
    "/home/arch-din1/.config/rental-outdoor/visual-verify.env",
    "/home/sentinelx/.config/rental-outdoor/visual-verify.env",
  ].filter(Boolean);

  return [...new Set(candidates.map((item) => path.resolve(item)))];
}

function loadSecretEnv() {
  const candidates = secretCandidates();
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(
        `Secret file terlalu permisif: ${filePath}. Set permission 600 agar browser credential tidak bocor.`,
      );
    }

    let values;
    try {
      values = parseEnvFile(filePath);
    } catch (error) {
      throw new Error(
        `Secret file ditemukan tetapi tidak dapat dibaca: ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { values, source: filePath };
  }

  return { values: {}, source: null };
}

function envValue(name, fileValues) {
  return process.env[name] ?? fileValues[name] ?? undefined;
}

function resolveAuthConfig(requestedMode, fileValues, secretSource) {
  const storageState = process.env.VISUAL_STORAGE_STATE || null;
  const email = envValue("VISUAL_AUTH_EMAIL", fileValues);
  const password = envValue("VISUAL_AUTH_PASSWORD", fileValues);

  if (requestedMode === "none") {
    return { mode: "none", email: null, password: null, storageState, source: "explicit-none" };
  }

  if (requestedMode === "storage-state") {
    if (!storageState) {
      throw new Error("VISUAL_STORAGE_STATE wajib diisi untuk --auth=storage-state.");
    }
    return { mode: "storage-state", email: null, password: null, storageState, source: "storage-state" };
  }

  if (requestedMode === "credentials") {
    if (!email || !password) {
      throw new Error(
        "Credential tidak tersedia. Isi VISUAL_AUTH_EMAIL/VISUAL_AUTH_PASSWORD melalui host environment atau visual-verify.env.",
      );
    }
    return {
      mode: "credentials",
      email,
      password,
      storageState: null,
      source: process.env.VISUAL_AUTH_EMAIL || process.env.VISUAL_AUTH_PASSWORD
        ? "process-env"
        : secretSource || "host-secret",
    };
  }

  if (requestedMode !== "auto") {
    throw new Error(`Auth mode tidak dikenal: ${requestedMode}`);
  }

  if (storageState) {
    return { mode: "storage-state", email: null, password: null, storageState, source: "storage-state" };
  }

  if (email && password) {
    return {
      mode: "credentials",
      email,
      password,
      storageState: null,
      source: process.env.VISUAL_AUTH_EMAIL || process.env.VISUAL_AUTH_PASSWORD
        ? "process-env"
        : secretSource || "host-secret",
    };
  }

  return { mode: "none", email: null, password: null, storageState: null, source: "no-auth-secret" };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function browserCandidates() {
  const candidates = [
    process.env.VISUAL_BROWSER_PATH,
    "/opt/sentinelx-cloud-core/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
    "/opt/sentinelx-cloud-core/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
    typeof chromium.executablePath === "function" ? chromium.executablePath() : null,
  ].filter(Boolean);

  return [...new Set(candidates)];
}

function findBrowser() {
  const browserPath = browserCandidates().find((candidate) => fs.existsSync(candidate));
  if (!browserPath) {
    throw new Error(
      "Chromium tidak ditemukan. Set VISUAL_BROWSER_PATH atau install browser Playwright pada host.",
    );
  }
  return browserPath;
}

async function waitForCdp(port, timeoutMs = DEFAULT_NAVIGATION_TIMEOUT) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // wait
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`CDP Chromium tidak siap pada port ${port}`);
}

async function startBrowser() {
  const port = await freePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "rental-browser-"));
  const browserPath = findBrowser();
  const logPath = path.join(profileDir, "browser.log");
  const output = fs.openSync(logPath, "a");

  const child = spawn(
    browserPath,
    [
      "--headless",
      "--no-sandbox",
      "--disable-crash-reporter",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-breakpad",
      "--disable-component-update",
      "--disable-default-apps",
      "--no-first-run",
      "--disable-sync",
      "--force-color-profile=srgb",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { detached: false, stdio: ["ignore", output, output] },
  );

  try {
    await waitForCdp(port);
  } catch (error) {
    child.kill("SIGTERM");
    try { fs.closeSync(output); } catch {}
    throw error;
  }

  return {
    child,
    port,
    profileDir,
    logPath,
    browserPath,
    async stop() {
      if (!child.killed) child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1500);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      try { fs.closeSync(output); } catch {}
      fs.rmSync(profileDir, { recursive: true, force: true });
    },
  };
}

async function loadStorageState(page, storageStatePath) {
  const absolutePath = path.resolve(ROOT, storageStatePath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const state = JSON.parse(raw);

  if (Array.isArray(state.cookies) && state.cookies.length) {
    await page.context().addCookies(state.cookies);
  }

  if (!Array.isArray(state.origins)) return;
  await page.addInitScript((origins) => {
    for (const origin of origins) {
      if (location.origin !== origin.origin) continue;
      for (const item of origin.localStorage || []) {
        localStorage.setItem(item.name, item.value);
      }
    }
  }, state.origins);
}

async function loginWithCredentials(page, credentials) {
  await page.goto(`${BASE_URL}/login`, {
    waitUntil: "domcontentloaded",
    timeout: DEFAULT_NAVIGATION_TIMEOUT,
  });

  await page.getByLabel("Email").fill(credentials.email);
  await page.locator('input[type="password"]').first().fill(credentials.password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();

  await page.waitForURL(
    (url) => !url.pathname.startsWith("/login"),
    { timeout: DEFAULT_NAVIGATION_TIMEOUT },
  );
}

async function waitForAppSettled(page) {
  await page.waitForTimeout(500);
  if (page.url().startsWith(`${BASE_URL}/login`)) return;
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}

function attachDiagnostics(page, diagnostics) {
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });

  page.on("pageerror", (error) => {
    diagnostics.pageErrors.push(error.message);
  });

  page.on("response", (response) => {
    const url = response.url();
    if (response.status() >= 400 && !url.includes("telemetry.refine.dev")) {
      diagnostics.httpErrors.push(`${response.status()} ${response.request().method()} ${url}`);
    }
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    const failure = request.failure()?.errorText || "failed";
    if (url.includes("telemetry.refine.dev")) return;
    if (failure === "net::ERR_ABORTED") return;
    diagnostics.requestFailures.push(
      `${request.method()} ${url}: ${failure}`,
    );
  });
}

async function capture(page, label, captures) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const viewport = page.viewportSize();
  const file = path.join(
    ARTIFACT_DIR,
    `${slug(label)}-${viewport?.width}x${viewport?.height}.png`,
  );
  await page.screenshot({ path: file, fullPage: true });
  const captureResult = {
    label,
    file,
    url: page.url(),
    title: await page.title(),
    viewport,
  };
  captures.push(captureResult);
  return captureResult;
}

async function runScenario(name, page, captures) {
  const scenarioPath = path.join(ROOT, "scripts/browser-verify/scenarios", `${name}.mjs`);
  if (!fs.existsSync(scenarioPath)) {
    throw new Error(`Scenario tidak ditemukan: ${scenarioPath}`);
  }

  const module = await import(pathToFileURL(scenarioPath).href);
  if (typeof module.default !== "function") {
    throw new Error(`Scenario ${name} harus export default async function.`);
  }

  return module.default({
    page,
    baseURL: BASE_URL,
    capture: (label) => capture(page, label, captures),
  });
}

async function stopTrace(context, traceMode, tracePath) {
  if (traceMode === "off") return false;
  try {
    await context.tracing.stop({ path: tracePath });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const scenario = arg("scenario", "penyewa");
  const route = arg("path", "/penyewa");
  const viewport = resolveViewport(arg("viewport"));
  const requestedAuthMode = arg("auth", "auto");
  const traceMode = arg("trace", process.env.VISUAL_TRACE || "retain-on-failure");
  const colorScheme = arg("color-scheme", process.env.VISUAL_COLOR_SCHEME || "light");
  const secret = loadSecretEnv();
  const auth = resolveAuthConfig(requestedAuthMode, secret.values, secret.source);

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const browserProcess = await startBrowser();
  const diagnostics = {
    consoleErrors: [],
    pageErrors: [],
    httpErrors: [],
    requestFailures: [],
  };
  const captures = [];
  let browser = null;
  let tracePath = path.join(
    ARTIFACT_DIR,
    `${slug(scenario)}-${viewport.width}x${viewport.height}.zip`,
  );
  let traceSaved = false;
  let finalState = "FAILED";
  let failure = null;
  let result = null;
  let finalURL = null;

  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${browserProcess.port}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    context.setDefaultTimeout(DEFAULT_TIMEOUT);
    context.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT);
    await page.emulateMedia({ colorScheme });

    if (traceMode !== "off") {
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
      });
    }

    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    attachDiagnostics(page, diagnostics);

    if (auth.mode === "credentials") {
      await loginWithCredentials(page, auth);
    } else if (auth.mode === "storage-state") {
      await loadStorageState(page, auth.storageState);
    }

    await page.goto(`${BASE_URL}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_NAVIGATION_TIMEOUT,
    });
    await waitForAppSettled(page);
    await capture(page, "initial", captures);

    result = await runScenario(scenario, page, captures);
    finalState = result?.state || "VERIFIED";
    finalURL = page.url();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    try {
      if (browser) {
        const page = browser.contexts()[0]?.pages()[0];
        if (page) {
          finalURL = page.url();
          await capture(page, "failure", captures);
        }
      }
    } catch {
      // best-effort failure evidence
    }
  } finally {
    if (browser) {
      traceSaved = await stopTrace(browser.contexts()[0], traceMode === "on" || finalState === "FAILED" ? "on" : "off", tracePath);
      await browser.close().catch(() => {});
    }
    await browserProcess.stop();
  }

  const report = {
    state: finalState,
    scenario,
    route,
    baseURL: BASE_URL,
    viewport,
    colorScheme,
    authMode: auth.mode,
    authSource: auth.source,
    secretConfigured: Boolean(secret.source),
    secretPathConfigured: Boolean(secret.source),
    storageStateConfigured: Boolean(auth.storageState),
    finalURL,
    captures,
    trace: traceSaved ? tracePath : null,
    diagnostics,
    error: failure,
    testedAt: new Date().toISOString(),
    browser: browserProcess.browserPath,
  };

  const reportPath = path.join(
    ARTIFACT_DIR,
    `${slug(scenario)}-${viewport.width}x${viewport.height}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (failure) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
