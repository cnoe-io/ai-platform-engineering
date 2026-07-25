/**
 * Command handlers for `caipe auth login/logout/status`.
 *
 * These are dynamically imported by index.ts to keep startup fast.
 */

import { ServerNotConfigured, getAuthUrl, readSettings } from "../platform/config.js";
import { runSetupWizard } from "../platform/setup.js";
import { clearTokens, loadTokens } from "./keychain.js";
import { loginBrowser, loginDevice, loginManual } from "./oauth.js";
import { displayIdentity, enrichTokenSet, isAuthenticatedSession } from "./session.js";
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
  opts: { manual?: boolean; device?: boolean; force?: boolean; setupWizard?: boolean },
  globalOpts: GlobalOpts,
): Promise<void> {
  // Resolve auth (caipe-ui/OAuth) URL
  let authUrl: string;
  try {
    authUrl = getAuthUrl(globalOpts.url);
    // Re-run setup wizard if explicitly requested
    if (opts.setupWizard) {
      authUrl = await runSetupWizard();
    }
  } catch (err) {
    if (err instanceof ServerNotConfigured) {
      // First run — wizard has not been completed yet
      authUrl = await runSetupWizard();
    } else {
      throw err;
    }
  }

  // Idempotency: already authenticated with a complete session?
  const existingRaw = await loadTokens();
  const existing = existingRaw ? enrichTokenSet(existingRaw) : null;
  if (existing && isAuthenticatedSession(existing, isExpired) && !opts.force) {
    const who = displayIdentity(existing);
    if (globalOpts.json) {
      process.stdout.write(
        `${JSON.stringify({
          authenticated: true,
          identity: existing.identity,
          displayName: existing.displayName,
          message: "Already authenticated",
        })}\n`,
      );
    } else {
      process.stdout.write(
        `Already authenticated as ${who}.\nRun \`caipe auth login --force\` to re-authenticate, or \`caipe auth logout\` first.\n`,
      );
    }
    return;
  }

  const clientId = DEFAULT_CLIENT_ID;

  if (opts.device) {
    await loginDevice(authUrl, clientId);
  } else if (opts.manual) {
    await loginManual(authUrl, clientId);
  } else {
    await loginBrowser(authUrl, clientId);
  }

  const tokensRaw = await loadTokens();
  const tokens = tokensRaw ? enrichTokenSet(tokensRaw) : null;
  const who = tokens ? displayIdentity(tokens) : "(authenticated)";
  if (globalOpts.json) {
    process.stdout.write(
      `${JSON.stringify({
        authenticated: true,
        identity: tokens?.identity,
        displayName: tokens?.displayName,
      })}\n`,
    );
  } else {
    process.stdout.write(`\nAuthenticated as ${who}.\n`);
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
    process.stdout.write("Logged out — credentials removed.\n");
  } else {
    process.stdout.write("No stored tokens found.\n");
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function runStatus(opts: { json?: boolean }, globalOpts: GlobalOpts): Promise<void> {
  const useJson = opts.json ?? globalOpts.json;
  const tokensRaw = await loadTokens();

  if (!tokensRaw) {
    if (useJson) {
      process.stdout.write(`${JSON.stringify({ authenticated: false })}\n`);
    } else {
      process.stdout.write("Not authenticated. Run `caipe auth login`.\n");
    }
    return;
  }

  const tokens = enrichTokenSet(tokensRaw);
  const expired = isExpired(tokens);
  const incomplete = !isAuthenticatedSession(tokens, isExpired);
  const expiresAt = tokens.accessTokenExpiry ?? null;
  const who = displayIdentity(tokens);

  if (useJson) {
    process.stdout.write(
      `${JSON.stringify({
        authenticated: !expired && !incomplete,
        identity: tokens.identity,
        displayName: tokens.displayName,
        expiresAt,
        incompleteSession: incomplete && !expired,
      })}\n`,
    );
  } else {
    if (expired) {
      process.stdout.write(`Session expired (${who}). Run \`caipe auth login\` to refresh.\n`);
    } else if (incomplete) {
      process.stdout.write(
        "Stored credentials are incomplete (unknown user). Run `caipe auth login` to sign in again.\n",
      );
    } else {
      process.stdout.write(`Authenticated as ${who}`);
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
