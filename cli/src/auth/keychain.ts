/**
 * Credential storage facade.
 *
 * Delegates to one of two backends based on settings.json `auth.credentialStorage`:
 *
 *   "encrypted-file" (default)
 *     AES-256-GCM encrypted file at ~/.config/caipe/credentials.enc.
 *     Key derived (PBKDF2) from a machine-specific seed (hardware UUID / machine-id).
 *     No OS prompts, no native modules.
 *
 *   "keychain"
 *     macOS Keychain / Linux Secret Service via the optional `keytar` native module.
 *     Falls back to encrypted-file if keytar is not installed.
 */

import { execSync } from "node:child_process";
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { globalConfigDir, readSettings } from "../platform/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** ISO 8601 datetime */
  accessTokenExpiry?: string;
  identity?: string;
  displayName?: string;
}

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

function getBackend(): "encrypted-file" | "keychain" {
  return readSettings().auth?.credentialStorage ?? "encrypted-file";
}

// ═══════════════════════════════════════════════════════════════════════════
// Backend 1: Encrypted file
// ═══════════════════════════════════════════════════════════════════════════

function credentialsPath(): string {
  return join(globalConfigDir(), "credentials.enc");
}

const SALT = "caipe-cli-credential-store-v1";
const KEY_LEN = 32; // AES-256
const PBKDF2_ITERATIONS = 100_000;

/**
 * Stable, machine-specific seed string.
 *   macOS:  IOPlatformUUID (survives OS reinstalls)
 *   Linux:  /etc/machine-id (stable per install)
 *   Fallback: hostname + uid
 */
function getMachineSeed(): string {
  if (process.platform === "darwin") {
    try {
      const out = execSync(
        "ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/{print $3}'",
        { encoding: "utf8", timeout: 3000 },
      )
        .trim()
        .replace(/"/g, "");
      if (out.length >= 16) return out;
    } catch {
      /* fall through */
    }
  }
  if (process.platform === "linux") {
    try {
      const mid = readFileSync("/etc/machine-id", "utf8").trim();
      if (mid.length >= 16) return mid;
    } catch {
      /* fall through */
    }
  }
  const info = userInfo();
  return `${hostname()}-${info.uid}-${info.username}`;
}

function deriveKey(): Buffer {
  return pbkdf2Sync(getMachineSeed(), SALT, PBKDF2_ITERATIONS, KEY_LEN, "sha256");
}

/** Encrypt plaintext → Buffer.  Format: [12-byte IV][16-byte auth tag][ciphertext] */
function encrypt(plaintext: string): Buffer {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(data: Buffer): string {
  const key = deriveKey();
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

async function encStore(tokens: TokenSet): Promise<void> {
  const dir = globalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(credentialsPath(), encrypt(JSON.stringify(tokens)), { mode: 0o600 });
}

async function encLoad(): Promise<TokenSet | null> {
  const path = credentialsPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(decrypt(readFileSync(path))) as TokenSet;
  } catch {
    return null;
  }
}

async function encClear(): Promise<boolean> {
  const path = credentialsPath();
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Backend 2: OS Keychain (keytar) — optional
// ═══════════════════════════════════════════════════════════════════════════

const KEYTAR_SERVICE = "CAIPE Platform Engineering CLI";
const KEYTAR_ACCOUNT = "tokens";

/** Lazy-load keytar. Returns null if the native module isn't available. */
async function tryKeytar(): Promise<typeof import("keytar") | null> {
  try {
    return await import("keytar");
  } catch {
    return null;
  }
}

async function keytarStore(tokens: TokenSet): Promise<void> {
  const kt = await tryKeytar();
  if (!kt) {
    process.stderr.write("[WARNING] keytar not available — falling back to encrypted-file.\n");
    return encStore(tokens);
  }
  await kt.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify(tokens));
}

async function keytarLoad(): Promise<TokenSet | null> {
  const kt = await tryKeytar();
  if (!kt) return encLoad();
  const raw = await kt.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
}

async function keytarClear(): Promise<boolean> {
  const kt = await tryKeytar();
  if (!kt) return encClear();
  return kt.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — delegates to the configured backend
// ═══════════════════════════════════════════════════════════════════════════

export async function storeTokens(tokens: TokenSet): Promise<void> {
  return getBackend() === "keychain" ? keytarStore(tokens) : encStore(tokens);
}

export async function loadTokens(): Promise<TokenSet | null> {
  return getBackend() === "keychain" ? keytarLoad() : encLoad();
}

export async function clearTokens(): Promise<boolean> {
  return getBackend() === "keychain" ? keytarClear() : encClear();
}
