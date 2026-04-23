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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Settings {
  server?: {
    /** A2A backend URL (e.g. http://localhost:8000) — CAIPE_SERVER_URL */
    url?: string;
  };
  auth?: {
    /** caipe-ui / OAuth URL (e.g. http://localhost:43000) — CAIPE_AUTH_URL */
    url?: string;
    apiKey?: string;
    /** Credential storage method. Default: "encrypted-file" (no OS prompts). */
    credentialStorage?: "encrypted-file" | "keychain";
  };
  setup?: {
    /** true once the user has completed or explicitly skipped the setup wizard */
    completed?: boolean;
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
  const xdg = process.env.XDG_CONFIG_HOME;
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

export function skillsCachePath(): string {
  return join(globalConfigDir(), "skills-cache.json");
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
  writeFileSync(settingsJsonPath(), `${JSON.stringify(s, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Server URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the caipe-ui / OAuth URL.
 *
 * Priority: flagOverride → CAIPE_AUTH_URL → settings.auth.url
 *           → settings.server.url (backward compat for single-URL setups)
 *
 * Throws ServerNotConfigured when nothing is configured.
 */
export function getAuthUrl(flagOverride?: string): string {
  if (flagOverride && flagOverride.trim() !== "") {
    return normalizeUrl(flagOverride);
  }
  const envAuth = process.env.CAIPE_AUTH_URL;
  if (envAuth && envAuth.trim() !== "") {
    return normalizeUrl(envAuth);
  }
  const settings = readSettings();
  if (settings.auth?.url && settings.auth.url.trim() !== "") {
    return normalizeUrl(settings.auth.url);
  }
  // Backward compat: old single-URL setups stored the UI URL in server.url
  if (settings.server?.url && settings.server.url.trim() !== "") {
    return normalizeUrl(settings.server.url);
  }
  throw new ServerNotConfigured();
}

/**
 * Resolve the A2A backend URL.
 *
 * Priority: CAIPE_SERVER_URL → settings.server.url (only when auth.url is
 * also explicitly configured, so we don't confuse the old single-URL setup
 * where server.url held the UI address).
 *
 * Returns undefined when not explicitly set — callers fall back to the
 * a2a.endpoint field from /.well-known/agent.json discovery.
 */
export function getA2aUrl(): string | undefined {
  const envServer = process.env.CAIPE_SERVER_URL;
  if (envServer && envServer.trim() !== "") {
    return normalizeUrl(envServer);
  }
  const settings = readSettings();
  const hasExplicitAuth =
    (settings.auth?.url && settings.auth.url.trim() !== "") ||
    (process.env.CAIPE_AUTH_URL && process.env.CAIPE_AUTH_URL.trim() !== "");
  if (hasExplicitAuth && settings.server?.url && settings.server.url.trim() !== "") {
    return normalizeUrl(settings.server.url);
  }
  return undefined;
}

/**
 * @deprecated Use getAuthUrl() for the UI/OAuth URL.
 * Kept as a thin alias so callers can be migrated incrementally.
 */
export function getServerUrl(flagOverride?: string): string {
  return getAuthUrl(flagOverride);
}

/** Strip trailing slash. Allow http://localhost for local dev; require https otherwise. */
function normalizeUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  const isLocalhost = url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1");
  if (!url.startsWith("https://") && !isLocalhost) {
    throw new Error(`Server URL must use HTTPS (or http://localhost for local dev): ${url}`);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Derived endpoint helpers
// ---------------------------------------------------------------------------

/** Fallback paths derived from the caipe-ui (auth) URL. */
export function authEndpoints(authUrl: string) {
  return {
    oauthBase: `${authUrl}/oauth`,
    deviceCode: `${authUrl}/oauth/device/code`,
    token: `${authUrl}/oauth/token`,
    agentCard: `${authUrl}/.well-known/agent.json`,
    agents: `${authUrl}/api/v1/agents`,
    aguiStream: `${authUrl}/api/agui/stream`,
    skills: `${authUrl}/api/skills`,
  };
}

/** Fallback paths derived from the A2A backend URL. */
export function serverEndpoints(a2aUrl: string) {
  return {
    a2aTask: `${a2aUrl}/tasks/send`,
    aguiStream: `${a2aUrl}/api/agui/stream`,
    agents: `${a2aUrl}/api/v1/agents`,
    skills: `${a2aUrl}/skills`,
  };
}

/**
 * @deprecated Use authEndpoints(authUrl) or serverEndpoints(a2aUrl).
 * Kept temporarily so in-flight callers still compile.
 */
export function endpoints(url: string) {
  return { ...authEndpoints(url), ...serverEndpoints(url) };
}
