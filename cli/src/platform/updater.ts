/**
 * Background update checker.
 *
 * On every interactive startup, checks GitHub Releases for a newer version.
 * The check runs in the background (non-blocking) with a 5-second timeout.
 * Result is cached in ~/.config/caipe/update-check.json (24-hour TTL) so
 * the network is only hit once per day.
 *
 * When a newer version is available, prints a notice after the logo:
 *
 *   ╭─────────────────────────────────────────────────╮
 *   │  Update available: v0.1.0 → v0.2.0              │
 *   │  Run: caipe update   or   brew upgrade caipe     │
 *   ╰─────────────────────────────────────────────────╯
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { globalConfigDir } from "./config.js";

const RELEASES_URL =
  "https://api.github.com/repos/cnoe-io/ai-platform-engineering/releases/latest";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CHECK_TIMEOUT_MS = 5_000;

interface UpdateCache {
  checkedAt: string;
  latestVersion: string | null;
}

function cachePath(): string {
  return join(globalConfigDir(), "update-check.json");
}

function readCache(): UpdateCache | null {
  try {
    if (!existsSync(cachePath())) return null;
    return JSON.parse(readFileSync(cachePath(), "utf8")) as UpdateCache;
  } catch {
    return null;
  }
}

function writeCache(data: UpdateCache): void {
  try {
    writeFileSync(cachePath(), `${JSON.stringify(data)}\n`, "utf8");
  } catch {
    // non-fatal
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "caipe-cli" },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string };
    const tag = body.tag_name ?? "";
    // tags may be "cli/v0.2.0" or "v0.2.0"
    const match = tag.match(/(\d+\.\d+\.\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Check for updates in the background (non-blocking).
 * Returns a promise that resolves to the latest version string if a newer
 * version exists, or null if up-to-date / check failed.
 *
 * Callers should await only if they want to show the banner before proceeding;
 * fire-and-forget is fine for background checks.
 */
export async function checkForUpdate(currentVersion: string): Promise<string | null> {
  const cached = readCache();
  const now = Date.now();

  let latestVersion: string | null;

  if (cached && now - Date.parse(cached.checkedAt) < CACHE_TTL_MS) {
    latestVersion = cached.latestVersion;
  } else {
    latestVersion = await fetchLatestVersion();
    writeCache({ checkedAt: new Date().toISOString(), latestVersion });
  }

  if (!latestVersion) return null;
  try {
    return semver.gt(latestVersion, currentVersion) ? latestVersion : null;
  } catch {
    return null;
  }
}

const NO_COLOR = Boolean(process.env.NO_COLOR);
const YELLOW = NO_COLOR ? "" : "\x1b[33m";
const CYAN = NO_COLOR ? "" : "\x1b[96m";
const BOLD = NO_COLOR ? "" : "\x1b[1m";
const DIM = NO_COLOR ? "" : "\x1b[2m";
const RESET = NO_COLOR ? "" : "\x1b[0m";

/**
 * Print the update notice banner to stdout.
 */
export function printUpdateBanner(currentVersion: string, latestVersion: string): void {
  // Plain-text versions determine visual widths; ANSI versions are for colour only.
  const plain1 = `Update available: v${currentVersion} → v${latestVersion}`;
  const plain2 = `Run: caipe update`;
  const innerWidth = Math.max(plain1.length, plain2.length) + 4; // 2 leading + 2 trailing spaces
  const bar = "─".repeat(innerWidth);

  const msg1 = `Update available: ${DIM}v${currentVersion}${RESET} → ${YELLOW}${BOLD}v${latestVersion}${RESET}`;
  const msg2 = `Run: ${CYAN}caipe update${RESET}`;

  if (NO_COLOR) {
    process.stdout.write(`\n  Update available: v${currentVersion} → v${latestVersion}\n`);
    process.stdout.write(`  Run: caipe update\n\n`);
    return;
  }

  // pad fills from after the 2 leading spaces to innerWidth, so right │ aligns with ╮/╯
  const pad = (plain: string) => " ".repeat(innerWidth - 2 - plain.length);
  process.stdout.write(`\n  ${YELLOW}╭${bar}╮${RESET}\n`);
  process.stdout.write(`  ${YELLOW}│${RESET}  ${msg1}${pad(plain1)}${YELLOW}│${RESET}\n`);
  process.stdout.write(`  ${YELLOW}│${RESET}  ${msg2}${pad(plain2)}${YELLOW}│${RESET}\n`);
  process.stdout.write(`  ${YELLOW}╰${bar}╯${RESET}\n\n`);
}
