/**
 * XDG-based config path helpers and settings management.
 *
 * All CAIPE CLI configuration lives under ~/.config/caipe/.
 * The single source of truth for the CAIPE server URL is:
 *   1. --url flag override (passed at call site)
 *   2. CAIPE_SERVER_URL env var
 *   3. settings.json server.url
 *   4. (interactive) → run setup wizard
 *   5. (headless)   → throw ServerNotConfigured
 */

import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Settings {
  server?: {
    url?: string;
  };
  auth?: {
    apiKey?: string;
  };
}

export class ServerNotConfigured extends Error {
  constructor() {
    super(
      "No CAIPE server URL configured. Run `caipe config set server.url https://your-caipe-server.example.com` " +
        "or set CAIPE_SERVER_URL.",
    );
    this.name = "ServerNotConfigured";
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function globalConfigDir(): string {
  // Respect XDG_CONFIG_HOME if set
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = xdg && xdg.trim() !== "" ? xdg : join(homedir(), ".config");
  return join(base, "caipe");
}

export function globalSkillsDir(): string {
  return join(globalConfigDir(), "skills");
}

export function sessionsDir(): string {
  return join(globalConfigDir(), "sessions");
}

export function globalMemoryFile(): string {
  return join(globalConfigDir(), "CLAUDE.md");
}

export function catalogCachePath(): string {
  return join(globalConfigDir(), "catalog-cache.json");
}

export function agentsCachePath(): string {
  return join(globalConfigDir(), "agents-cache.json");
}

export function configJsonPath(): string {
  return join(globalConfigDir(), "config.json");
}

export function settingsJsonPath(): string {
  return join(globalConfigDir(), "settings.json");
}

/**
 * Walk up from `cwd` looking for a `.claude/` directory adjacent to `.git`.
 * Returns the first match, or null if we reach the filesystem root.
 */
export function projectClaudeDir(cwd: string): string | null {
  const { sep } = require("path") as typeof import("path");
  let dir = cwd;
  while (true) {
    const gitDir = join(dir, ".git");
    const claudeDir = join(dir, ".claude");
    if (existsSync(gitDir) && existsSync(claudeDir)) {
      return claudeDir;
    }
    if (existsSync(gitDir)) {
      // .git exists but .claude doesn't — return null, caller creates it
      return null;
    }
    const parent = join(dir, "..");
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
}

/**
 * Returns the project-level skills directory.
 * Prefers `.claude/` if it exists (or will be created), else `skills/`.
 */
export function projectSkillsDir(cwd: string): string | null {
  const claudeDir = projectClaudeDir(cwd);
  if (claudeDir !== null) return claudeDir;
  // Fall back to skills/ relative to cwd if inside a git repo
  const skillsDir = join(cwd, "skills");
  return existsSync(join(cwd, ".git")) ? skillsDir : null;
}

// ---------------------------------------------------------------------------
// Settings read/write
// ---------------------------------------------------------------------------

function ensureConfigDir(): void {
  const dir = globalConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function readSettings(): Settings {
  const path = settingsJsonPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Settings;
  } catch {
    return {};
  }
}

export function writeSettings(s: Settings): void {
  ensureConfigDir();
  writeFileSync(settingsJsonPath(), JSON.stringify(s, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Server URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the CAIPE server base URL with priority:
 *   flagOverride → CAIPE_SERVER_URL env → settings.server.url → throw/wizard
 *
 * In interactive mode (`headless: false`) callers should catch
 * `ServerNotConfigured` and invoke the setup wizard.
 * In headless mode (`headless: true`) callers should let the error propagate
 * so the process exits 1 with a JSON error.
 */
export function getServerUrl(flagOverride?: string): string {
  if (flagOverride && flagOverride.trim() !== "") {
    return normalizeUrl(flagOverride);
  }
  const env = process.env["CAIPE_SERVER_URL"];
  if (env && env.trim() !== "") {
    return normalizeUrl(env);
  }
  const settings = readSettings();
  if (settings.server?.url && settings.server.url.trim() !== "") {
    return normalizeUrl(settings.server.url);
  }
  throw new ServerNotConfigured();
}

/** Strip trailing slash; reject non-HTTPS. */
function normalizeUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  if (!url.startsWith("https://")) {
    throw new Error(`Server URL must use HTTPS: ${url}`);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Derived endpoint helpers
// ---------------------------------------------------------------------------

export function endpoints(serverUrl: string) {
  return {
    oauthBase: `${serverUrl}/oauth`,
    deviceCode: `${serverUrl}/oauth/device/code`,
    token: `${serverUrl}/oauth/token`,
    agents: `${serverUrl}/api/v1/agents`,
    a2aTask: `${serverUrl}/tasks/send`,
    aguiStream: `${serverUrl}/api/agui/stream`,
    agentCard: `${serverUrl}/.well-known/agent.json`,
  };
}
