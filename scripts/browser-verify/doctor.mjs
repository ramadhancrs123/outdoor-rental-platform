#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const ROOT = process.cwd();
const BASE_URL = (process.env.VISUAL_BASE_URL || "http://127.0.0.1:5173").replace(/\/$/, "");

function parseEnvFile(filePath) {
  const values = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function secretCandidates() {
  return [...new Set([
    process.env.VISUAL_AUTH_ENV_FILE,
    `${ROOT}/.config/rental-outdoor/visual-verify.env`,
    `${ROOT}/../.config/rental-outdoor/visual-verify.env`,
    `${process.env.HOME || ""}/.config/rental-outdoor/visual-verify.env`,
    "/home/arch-din1/.config/rental-outdoor/visual-verify.env",
    "/home/sentinelx/.config/rental-outdoor/visual-verify.env",
  ].filter(Boolean))];
}

function findSecret() {
  for (const filePath of secretCandidates()) {
    if (!fs.existsSync(filePath)) continue;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;
    return { path: filePath, mode: (stat.mode & 0o777).toString(8), values: parseEnvFile(filePath) };
  }
  return null;
}

function findBrowser() {
  const candidates = [
    process.env.VISUAL_BROWSER_PATH,
    "/opt/sentinelx-cloud-core/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
    "/opt/sentinelx-cloud-core/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
    typeof chromium.executablePath === "function" ? chromium.executablePath() : null,
  ].filter(Boolean);
  return [...new Set(candidates)].find((candidate) => fs.existsSync(candidate)) || null;
}

async function portOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(800);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

async function main() {
  const pkg = require("@playwright/test/package.json");
  const secret = findSecret();
  const browser = findBrowser();
  const rootExists = fs.existsSync(ROOT);
  let appReachable = false;
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(1200) });
    appReachable = response.ok || response.status < 500;
  } catch {}

  let cdpReady = false;
  if (browser) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const value = typeof address === "object" && address ? address.port : null;
        server.close((error) => error ? reject(error) : resolve(value));
      });
    });

    const { spawn } = await import("node:child_process");
    const os = await import("node:os");
    const profile = fs.mkdtempSync(`${os.tmpdir()}/rental-doctor-`);
    const child = spawn(browser, [
      "--headless", "--no-sandbox", "--disable-crash-reporter", "--disable-dev-shm-usage",
      "--no-first-run", "--disable-sync", "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: "ignore" });

    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (await portOpen("127.0.0.1", port)) {
        cdpReady = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }

  console.log(JSON.stringify({
    workspace: rootExists ? "OK" : "MISSING",
    playwright: pkg.version,
    browser: browser || "MISSING",
    chromiumCdp: cdpReady ? "OK" : "FAILED",
    baseURL: BASE_URL,
    localApp: appReachable ? "REACHABLE" : "UNREACHABLE",
    authSecret: secret
      ? {
          status: "FOUND",
          path: secret.path,
          permission: secret.mode,
          permissionSafe: secret.mode === "600",
          emailConfigured: Boolean(secret.values.VISUAL_AUTH_EMAIL),
          passwordConfigured: Boolean(secret.values.VISUAL_AUTH_PASSWORD),
        }
      : { status: "NOT_FOUND" },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
