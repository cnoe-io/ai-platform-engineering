/**
 * Command handlers for `caipe config set/get/unset`.
 */

import { readSettings, writeSettings } from "./config.js";
import { clearAgentConfigCache } from "./discovery.js";

function normalizeConfigUrl(value: string, key: string): string {
  const v = value.trim().replace(/\/+$/, "");
  const isLocalhost = v.startsWith("http://localhost") || v.startsWith("http://127.0.0.1");
  if (!v.startsWith("https://") && !isLocalhost) {
    process.stderr.write(`[ERROR] ${key} must be https:// (or http://localhost for local dev).\n`);
    process.exit(3);
  }
  return v;
}

type SupportedKey = "auth.url" | "server.url" | "auth.apiKey" | "auth.credential-storage";

const SUPPORTED_KEYS: SupportedKey[] = [
  "auth.url",
  "server.url",
  "auth.apiKey",
  "auth.credential-storage",
];

const CREDENTIAL_STORAGE_VALUES = ["encrypted-file", "keychain"] as const;

function assertSupportedKey(key: string): asserts key is SupportedKey {
  if (!SUPPORTED_KEYS.includes(key as SupportedKey)) {
    process.stderr.write(
      `[ERROR] Unknown config key "${key}". Supported keys: ${SUPPORTED_KEYS.join(", ")}\n`,
    );
    process.exit(3);
  }
}

// ---------------------------------------------------------------------------
// config set
// ---------------------------------------------------------------------------

export async function runConfigSet(key: string, value: string): Promise<void> {
  assertSupportedKey(key);

  if (key === "auth.url") {
    const v = normalizeConfigUrl(value, "auth.url");
    const settings = readSettings();
    settings.auth = { ...settings.auth, url: v };
    writeSettings(settings);
    clearAgentConfigCache();
    process.stdout.write(`Set auth.url = ${v}\n`);
    return;
  }

  if (key === "server.url") {
    const v = normalizeConfigUrl(value, "server.url");
    const settings = readSettings();
    settings.server = { ...settings.server, url: v };
    writeSettings(settings);
    // Invalidate cached discovery doc — new server may have different endpoints
    clearAgentConfigCache();
    process.stdout.write(`Set server.url = ${v}\n`);
    return;
  }

  if (key === "auth.apiKey") {
    const settings = readSettings();
    settings.auth = { ...settings.auth, apiKey: value.trim() };
    writeSettings(settings);
    process.stdout.write("Set auth.apiKey (value hidden)\n");
    return;
  }

  if (key === "auth.credential-storage") {
    const v = value.trim() as (typeof CREDENTIAL_STORAGE_VALUES)[number];
    if (!CREDENTIAL_STORAGE_VALUES.includes(v)) {
      process.stderr.write(
        `[ERROR] auth.credential-storage must be one of: ${CREDENTIAL_STORAGE_VALUES.join(", ")}\n`,
      );
      process.exit(3);
    }
    const settings = readSettings();
    settings.auth = { ...settings.auth, credentialStorage: v };
    writeSettings(settings);
    process.stdout.write(`Set auth.credential-storage = ${v}\n`);
    return;
  }
}

// ---------------------------------------------------------------------------
// config get
// ---------------------------------------------------------------------------

export async function runConfigGet(key: string, opts: { json?: boolean }): Promise<void> {
  assertSupportedKey(key);

  const settings = readSettings();
  let value: string | undefined;
  let source = "settings.json";

  if (key === "auth.url") {
    const envVal = process.env.CAIPE_AUTH_URL;
    if (envVal) {
      value = envVal;
      source = "CAIPE_AUTH_URL env var";
    } else {
      value = settings.auth?.url;
    }
  } else if (key === "server.url") {
    const envVal = process.env.CAIPE_SERVER_URL;
    if (envVal) {
      value = envVal;
      source = "CAIPE_SERVER_URL env var";
    } else {
      value = settings.server?.url;
    }
  } else if (key === "auth.apiKey") {
    value = settings.auth?.apiKey;
  } else if (key === "auth.credential-storage") {
    value = settings.auth?.credentialStorage ?? "encrypted-file";
    source = settings.auth?.credentialStorage ? "settings.json" : "default";
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ key, value: value ?? null, source })}\n`);
    return;
  }

  if (value !== undefined) {
    // Mask API keys in plain output
    const display = key === "auth.apiKey" ? "***" : value;
    process.stdout.write(`${key} = ${display}  (from ${source})\n`);
  } else {
    process.stdout.write(`${key} is not set.\n`);
  }
}

// ---------------------------------------------------------------------------
// config unset
// ---------------------------------------------------------------------------

export async function runConfigUnset(key: string): Promise<void> {
  assertSupportedKey(key);

  // Prompt for confirmation
  process.stdout.write(`Remove ${key} from settings.json? [y/N] `);
  const answer = await readLine();
  if (!answer.trim().toLowerCase().startsWith("y")) {
    process.stdout.write("Cancelled.\n");
    return;
  }

  const settings = readSettings();

  if (key === "auth.url" && settings.auth) {
    settings.auth.url = undefined;
  } else if (key === "server.url" && settings.server) {
    settings.server.url = undefined;
  } else if (key === "auth.apiKey" && settings.auth) {
    settings.auth.apiKey = undefined;
  } else if (key === "auth.credential-storage" && settings.auth) {
    settings.auth.credentialStorage = undefined;
  }

  writeSettings(settings);
  process.stdout.write(`Removed ${key}.\n`);
}

async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(buf.slice(0, nl));
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}
