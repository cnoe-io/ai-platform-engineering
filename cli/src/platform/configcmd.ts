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

type SupportedKey =
  | "auth.url"
  | "server.url"
  | "auth.apiKey"
  | "auth.credential-storage"
  | "auth.idp-hint"
  | "chat.plain-markdown"
  | "chat.default-agent"
  | "chat.tool-approval";

const SUPPORTED_KEYS: SupportedKey[] = [
  "auth.url",
  "server.url",
  "auth.apiKey",
  "auth.credential-storage",
  "auth.idp-hint",
  "chat.plain-markdown",
  "chat.default-agent",
  "chat.tool-approval",
];

const CREDENTIAL_STORAGE_VALUES = ["encrypted-file", "keychain"] as const;
const TOOL_APPROVAL_VALUES = ["auto", "prompt", "deny"] as const;

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
    // Single-URL Grid/caipe-ui setups: OAuth and BFF share the same host.
    settings.auth = { ...settings.auth, url: v };
    writeSettings(settings);
    // Invalidate cached discovery doc — new server may have different endpoints
    clearAgentConfigCache();
    process.stdout.write(`Set server.url = ${v}\n`);
    process.stdout.write(`Set auth.url = ${v}\n`);
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

  if (key === "auth.idp-hint") {
    const settings = readSettings();
    settings.auth = { ...settings.auth, idpHint: value.trim() };
    writeSettings(settings);
    process.stdout.write(`Set auth.idp-hint = ${value.trim()}\n`);
    return;
  }

  if (key === "chat.plain-markdown") {
    const v = value.trim().toLowerCase();
    if (!["true", "false", "1", "0"].includes(v)) {
      process.stderr.write("[ERROR] chat.plain-markdown must be true or false.\n");
      process.exit(3);
    }
    const settings = readSettings();
    settings.chat = { ...settings.chat, plainMarkdown: v === "true" || v === "1" };
    writeSettings(settings);
    process.stdout.write(`Set chat.plain-markdown = ${settings.chat.plainMarkdown}\n`);
    return;
  }

  if (key === "chat.default-agent") {
    const settings = readSettings();
    settings.chat = { ...settings.chat, defaultAgent: value.trim() };
    writeSettings(settings);
    process.stdout.write(`Set chat.default-agent = ${value.trim()}\n`);
    return;
  }

  if (key === "chat.tool-approval") {
    const v = value.trim() as (typeof TOOL_APPROVAL_VALUES)[number];
    if (!TOOL_APPROVAL_VALUES.includes(v)) {
      process.stderr.write(
        `[ERROR] chat.tool-approval must be one of: ${TOOL_APPROVAL_VALUES.join(", ")}\n`,
      );
      process.exit(3);
    }
    const settings = readSettings();
    settings.chat = { ...settings.chat, toolApproval: v };
    writeSettings(settings);
    process.stdout.write(`Set chat.tool-approval = ${v}\n`);
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
  } else if (key === "auth.idp-hint") {
    const envVal = process.env.CAIPE_IDP_HINT;
    if (envVal) {
      value = envVal;
      source = "CAIPE_IDP_HINT env var";
    } else {
      value = settings.auth?.idpHint;
    }
  } else if (key === "chat.plain-markdown") {
    if (process.env.CAIPE_PLAIN_MARKDOWN === "1") {
      value = "true";
      source = "CAIPE_PLAIN_MARKDOWN env var";
    } else {
      value =
        settings.chat?.plainMarkdown === true
          ? "true"
          : settings.chat?.plainMarkdown === false
            ? "false"
            : undefined;
    }
  } else if (key === "chat.default-agent") {
    const envVal = process.env.CAIPE_DEFAULT_AGENT;
    if (envVal) {
      value = envVal;
      source = "CAIPE_DEFAULT_AGENT env var";
    } else {
      value = settings.chat?.defaultAgent;
    }
  } else if (key === "chat.tool-approval") {
    const envVal = process.env.CAIPE_TOOL_APPROVAL;
    if (envVal) {
      value = envVal;
      source = "CAIPE_TOOL_APPROVAL env var";
    } else {
      value = settings.chat?.toolApproval ?? "prompt";
      source = settings.chat?.toolApproval ? "settings.json" : "default";
    }
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
  } else if (key === "auth.idp-hint" && settings.auth) {
    settings.auth.idpHint = undefined;
  } else if (key === "chat.plain-markdown" && settings.chat) {
    settings.chat.plainMarkdown = undefined;
  } else if (key === "chat.default-agent" && settings.chat) {
    settings.chat.defaultAgent = undefined;
  } else if (key === "chat.tool-approval" && settings.chat) {
    settings.chat.toolApproval = undefined;
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
