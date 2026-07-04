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
    /** Legacy field — kept for backward compat reading old settings.json */
    url?: string;
  };
  auth?: {
    /** caipe-ui / OAuth URL (e.g. http://localhost:43000) — CAIPE_AUTH_URL */
    url?: string;
    apiKey?: string;
    /** Credential storage method. Default: "encrypted-file" (no OS prompts). */
    credentialStorage?: "encrypted-file" | "keychain";
    /**
     * Keycloak identity-provider alias to skip the login chooser page.
     * Appended as kc_idp_hint=<value> on the authorization URL.
     * Env override: CAIPE_IDP_HINT
     */
    idpHint?: string;
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

const DEFAULT_SETTINGS: Settings = {
  server: { url: "http://localhost:3000" },
  auth: { url: "http://localhost:7080/realms/caipe" },
};

export function readSettings(): Settings {
  const path = settingsJsonPath();
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
  try {
    const saved = JSON.parse(readFileSync(path, "utf8")) as Settings;
    // Merge: saved values win; fall back to defaults for any missing key
    return {
      server: { ...DEFAULT_SETTINGS.server, ...saved.server },
      auth: { ...DEFAULT_SETTINGS.auth, ...saved.auth },
      setup: saved.setup,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
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
 * Resolve the caipe-ui BFF URL (for API calls: stream, agents, etc.).
 *
 * Priority: flagOverride → CAIPE_SERVER_URL → settings.server.url
 *           → settings.auth.url (fallback for single-URL setups where both
 *             OAuth and the BFF are on the same host, e.g. caipe-ui proxying KC)
 *
 * Throws ServerNotConfigured when nothing is configured.
 */
export function getServerUrl(flagOverride?: string): string {
  if (flagOverride && flagOverride.trim() !== "") {
    return normalizeUrl(flagOverride);
  }
  const envServer = process.env.CAIPE_SERVER_URL;
  if (envServer && envServer.trim() !== "") {
    return normalizeUrl(envServer);
  }
  const settings = readSettings();
  if (settings.server?.url && settings.server.url.trim() !== "") {
    return normalizeUrl(settings.server.url);
  }
  // Fallback: single-URL setup where caipe-ui also proxies OAuth
  if (settings.auth?.url && settings.auth.url.trim() !== "") {
    return normalizeUrl(settings.auth.url);
  }
  throw new ServerNotConfigured();
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

/**
 * Resolve the IdP hint (Keycloak kc_idp_hint alias).
 * Priority: CAIPE_IDP_HINT env → settings.auth.idpHint
 */
export function getIdpHint(): string | undefined {
  const env = process.env.CAIPE_IDP_HINT;
  if (env && env.trim() !== "") return env.trim();
  return readSettings().auth?.idpHint;
}

/** Endpoints derived from the caipe-ui (auth) URL. */
export function authEndpoints(authUrl: string) {
  return {
    oauthBase: `${authUrl}/oauth`,
    deviceCode: `${authUrl}/oauth/device/code`,
    token: `${authUrl}/oauth/token`,
    agentCard: `${authUrl}/.well-known/agent.json`,
    agents: `${authUrl}/api/user/accessible-agents`,
    streamStart: `${authUrl}/api/v1/chat/stream/start`,
    skills: `${authUrl}/api/skills`,
  };
}

