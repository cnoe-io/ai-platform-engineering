/**
 * Command handlers for `caipe auth login/logout/status`.
 *
 * These are dynamically imported by index.ts to keep startup fast.
 */

import {
  getServerUrl,
  readSettings,
  ServerNotConfigured,
} from "../platform/config.js";
import { runSetupWizard } from "../platform/setup.js";
import { clearTokens, loadTokens } from "./keychain.js";
import { loginBrowser, loginDevice, loginManual } from "./oauth.js";
import { isExpired } from "./tokens.js";

// The CAIPE server's OAuth client_id is well-known (public PKCE client).
// In v1 we use a fixed client_id; future: read from /.well-known/agent.json.
const DEFAULT_CLIENT_ID = "caipe-cli";

interface GlobalOpts {
  url?: string;
  json?: boolean;
}

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

export async function runLogin(
  opts: { manual?: boolean; device?: boolean; force?: boolean },
  globalOpts: GlobalOpts,
): Promise<void> {
  // Resolve server URL — run setup wizard if not configured
  let serverUrl: string;
  try {
    serverUrl = getServerUrl(globalOpts.url);
  } catch (err) {
    if (err instanceof ServerNotConfigured) {
      serverUrl = await runSetupWizard();
    } else {
      throw err;
    }
  }

  // Idempotency: already authenticated?
  const existing = await loadTokens();
  if (existing && !isExpired(existing) && !opts.force) {
    const identity = existing.identity ?? "(unknown)";
    if (globalOpts.json) {
      process.stdout.write(
        JSON.stringify({ authenticated: true, identity, message: "Already authenticated" }) +
          "\n",
      );
    } else {
      process.stdout.write(
        `Already authenticated as ${identity}.\n` +
          `Run \`caipe auth login --force\` to re-authenticate, or \`caipe auth logout\` first.\n`,
      );
    }
    return;
  }

  const clientId = DEFAULT_CLIENT_ID;

  if (opts.device) {
    await loginDevice(serverUrl, clientId);
  } else if (opts.manual) {
    await loginManual(serverUrl, clientId);
  } else {
    await loginBrowser(serverUrl, clientId);
  }

  const tokens = await loadTokens();
  const identity = tokens?.identity ?? "(authenticated)";
  if (globalOpts.json) {
    process.stdout.write(JSON.stringify({ authenticated: true, identity }) + "\n");
  } else {
    process.stdout.write(`\nAuthenticated as ${identity}.\n`);
  }
}

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

export async function runLogout(): Promise<void> {
  // Prompt for confirmation
  process.stdout.write("Are you sure you want to log out? [y/N] ");
  const answer = await readLine();
  if (!answer.trim().toLowerCase().startsWith("y")) {
    process.stdout.write("Cancelled.\n");
    return;
  }

  const removed = await clearTokens();
  if (removed) {
    process.stdout.write("Logged out — tokens removed from keychain.\n");
  } else {
    process.stdout.write("No stored tokens found.\n");
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function runStatus(
  opts: { json?: boolean },
  globalOpts: GlobalOpts,
): Promise<void> {
  const useJson = opts.json ?? globalOpts.json;
  const tokens = await loadTokens();

  if (!tokens) {
    if (useJson) {
      process.stdout.write(JSON.stringify({ authenticated: false }) + "\n");
    } else {
      process.stdout.write("Not authenticated. Run `caipe auth login`.\n");
    }
    return;
  }

  const expired = isExpired(tokens);
  const expiresAt = tokens.accessTokenExpiry ?? null;
  const identity = tokens.identity ?? "(unknown)";

  if (useJson) {
    process.stdout.write(
      JSON.stringify({ authenticated: !expired, identity, expiresAt }) + "\n",
    );
  } else {
    if (expired) {
      process.stdout.write(`Session expired (${identity}). Run \`caipe auth login\` to refresh.\n`);
    } else {
      process.stdout.write(`Authenticated as ${identity}`);
      if (expiresAt) {
        process.stdout.write(` (expires ${new Date(expiresAt).toLocaleString()})`);
      }
      process.stdout.write("\n");
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Keep settings available for config operations
export { readSettings };
