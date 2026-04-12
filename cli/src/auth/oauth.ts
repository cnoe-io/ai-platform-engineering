/**
 * OAuth 2.0 authentication flows:
 *
 *   1. Default (PKCE): Open browser → local callback server → exchange code
 *   2. --manual:       Print auth URL → user copies to browser → pastes code back
 *   3. --device:       RFC 8628 Device Authorization Grant — display user_code +
 *                      verification_uri → poll token endpoint until approved
 *
 * All three paths store the resulting TokenSet via keychain.ts.
 * All endpoints are derived from the configured serverUrl.
 */

import { createHash, randomBytes } from "crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { endpoints } from "../platform/config.js";
import { storeTokens, type TokenSet } from "./keychain.js";

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

export interface PKCEPair {
  verifier: string;
  challenge: string;
}

/**
 * Generate a PKCE code verifier (43–128 chars) and its S256 challenge.
 */
export function generatePKCE(): PKCEPair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// Local redirect capture server
// ---------------------------------------------------------------------------

export interface CallbackResult {
  code: string;
  state: string;
}

/**
 * Spin up a local HTTP server on `port` that captures the OAuth redirect.
 * Returns a promise that resolves on the first `?code=` request.
 */
export async function startCallbackServer(port: number): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body>Missing code parameter. Close this tab.</body></html>");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body><h2>Authentication successful!</h2>" +
          "<p>You may close this tab and return to the terminal.</p></body></html>",
      );

      server.close(() => resolve({ code, state }));
    });

    server.on("error", reject);
    server.listen(port);
  });
}

// ---------------------------------------------------------------------------
// Browser launcher (best-effort)
// ---------------------------------------------------------------------------

/**
 * Attempt to open `url` in the default browser.
 * Silently fails if no browser is available (headless/SSH).
 */
export async function openBrowser(url: string): Promise<void> {
  const { execa } = await import("execa");
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", url] : [url];
  try {
    await execa(cmd, args, { stdio: "ignore" });
  } catch {
    // Ignore — user will get the URL printed below
  }
}

// ---------------------------------------------------------------------------
// Token exchange (PKCE)
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for tokens using PKCE.
 */
export async function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string,
  serverUrl: string,
  clientId: string,
): Promise<TokenSet> {
  const ep = endpoints(serverUrl);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: clientId,
  });

  const res = await fetch(ep.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return parseTokenResponse(await res.json() as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// PKCE browser flow
// ---------------------------------------------------------------------------

export async function loginBrowser(serverUrl: string, clientId: string): Promise<TokenSet> {
  const { verifier, challenge } = generatePKCE();
  const redirectUri = "http://127.0.0.1:7842/callback";
  const state = randomBytes(16).toString("hex");

  const ep = endpoints(serverUrl);
  const authUrl =
    `${ep.oauthBase}/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code_challenge=${challenge}` +
    `&code_challenge_method=S256` +
    `&state=${state}`;

  const callbackPromise = startCallbackServer(7842);

  process.stdout.write(`Opening browser for authentication…\n`);
  process.stdout.write(`  ${authUrl}\n\n`);
  await openBrowser(authUrl);

  const { code } = await callbackPromise;
  const tokens = await exchangeCode(code, verifier, redirectUri, serverUrl, clientId);
  await storeTokens(tokens);
  return tokens;
}

// ---------------------------------------------------------------------------
// --manual flow
// ---------------------------------------------------------------------------

export async function loginManual(serverUrl: string, clientId: string): Promise<TokenSet> {
  const { verifier, challenge } = generatePKCE();
  const redirectUri = "urn:ietf:wg:oauth:2.0:oob";
  const state = randomBytes(16).toString("hex");

  const ep = endpoints(serverUrl);
  const authUrl =
    `${ep.oauthBase}/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code_challenge=${challenge}` +
    `&code_challenge_method=S256` +
    `&state=${state}`;

  process.stdout.write("\n=== CAIPE Manual Authentication ===\n\n");
  process.stdout.write("Open this URL in a browser to authenticate:\n\n");
  process.stdout.write(`  ${authUrl}\n\n`);
  process.stdout.write("After approving, paste the authorization code here:\n> ");

  const code = await readLine();

  const tokens = await exchangeCode(
    code.trim(),
    verifier,
    redirectUri,
    serverUrl,
    clientId,
  );
  await storeTokens(tokens);
  return tokens;
}

// ---------------------------------------------------------------------------
// --device flow (RFC 8628 Device Authorization Grant)
// ---------------------------------------------------------------------------

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

interface TokenErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * RFC 8628 Device Authorization Grant.
 *
 * 1. POST /oauth/device/code → display user_code + verification_uri
 * 2. Poll /oauth/token until success or terminal error:
 *    - authorization_pending → continue
 *    - slow_down             → add 5s, continue
 *    - access_denied         → exit 1
 *    - expired_token         → exit 1
 *    - unsupported_grant_type / 404 → exit 1, suggest --manual
 */
export async function loginDevice(serverUrl: string, clientId: string): Promise<TokenSet> {
  const ep = endpoints(serverUrl);

  // Step 1: request device code
  let dcRes: Response;
  try {
    dcRes = await fetch(ep.deviceCode, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId }).toString(),
    });
  } catch (err) {
    throw new Error(`Device auth request failed: ${String(err)}`);
  }

  if (dcRes.status === 404) {
    process.stderr.write(
      "[ERROR] Server does not support device auth — use `caipe auth login --manual` instead.\n",
    );
    process.exit(1);
  }

  if (!dcRes.ok) {
    const body = (await dcRes.json().catch(() => ({}))) as TokenErrorResponse;
    if (
      body.error === "unsupported_grant_type" ||
      body.error === "unsupported_response_type"
    ) {
      process.stderr.write(
        "[ERROR] Server does not support device auth — use `caipe auth login --manual` instead.\n",
      );
      process.exit(1);
    }
    throw new Error(`Device code request failed (${dcRes.status})`);
  }

  const dc = (await dcRes.json()) as DeviceCodeResponse;

  // Step 2: display code to user
  process.stdout.write("\n=== CAIPE Device Authorization ===\n\n");
  process.stdout.write("To authenticate, visit:\n\n");
  process.stdout.write(`  ${dc.verification_uri}\n\n`);
  process.stdout.write("And enter the code:\n\n");
  process.stdout.write(`  ┌─────────────────┐\n`);
  process.stdout.write(`  │  ${dc.user_code.padEnd(15)}  │\n`);
  process.stdout.write(`  └─────────────────┘\n\n`);
  if (dc.verification_uri_complete) {
    process.stdout.write(`Or open directly:\n  ${dc.verification_uri_complete}\n\n`);
  }
  process.stdout.write("Waiting for authorization");

  // Step 3: poll token endpoint
  let interval = dc.interval ?? 5;
  const expiresAt = Date.now() + dc.expires_in * 1000;

  while (Date.now() < expiresAt) {
    await sleep(interval * 1000);
    process.stdout.write(".");

    let tokenRes: Response;
    try {
      tokenRes = await fetch(ep.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: dc.device_code,
          client_id: clientId,
        }).toString(),
      });
    } catch {
      // Transient network error — retry on next tick
      continue;
    }

    if (tokenRes.ok) {
      process.stdout.write("\n\n");
      const tokens = parseTokenResponse(
        (await tokenRes.json()) as Record<string, unknown>,
      );
      await storeTokens(tokens);
      return tokens;
    }

    const errBody = (await tokenRes.json().catch(() => ({}))) as TokenErrorResponse;

    switch (errBody.error) {
      case "authorization_pending":
        // Normal — user hasn't approved yet; keep polling silently
        continue;

      case "slow_down":
        // Server asks us to back off
        interval += 5;
        continue;

      case "access_denied":
        process.stdout.write("\n");
        process.stderr.write("[ERROR] Authorization denied by user.\n");
        process.exit(1);
        break;

      case "expired_token":
        process.stdout.write("\n");
        process.stderr.write(
          "[ERROR] Device code expired — re-run `caipe auth login --device` to start a new request.\n",
        );
        process.exit(1);
        break;

      case "unsupported_grant_type":
        process.stdout.write("\n");
        process.stderr.write(
          "[ERROR] Server does not support device auth — use `caipe auth login --manual` instead.\n",
        );
        process.exit(1);
        break;

      default:
        throw new Error(
          `Token poll error (${tokenRes.status}): ${errBody.error ?? "unknown"}`,
        );
    }
  }

  process.stdout.write("\n");
  process.stderr.write(
    "[ERROR] Device code expired — re-run `caipe auth login --device` to start a new request.\n",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTokenResponse(body: Record<string, unknown>): TokenSet {
  const accessToken = String(body["access_token"] ?? "");
  const refreshToken = body["refresh_token"] != null ? String(body["refresh_token"]) : undefined;
  const expiresIn =
    typeof body["expires_in"] === "number" ? body["expires_in"] : 3600;
  const accessTokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Optional OIDC claims
  const idToken = body["id_token"];
  let identity: string | undefined;
  let displayName: string | undefined;
  if (typeof idToken === "string") {
    try {
      // Decode JWT payload (base64url, no verification — server already validated)
      const payload = JSON.parse(
        Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString(),
      ) as Record<string, unknown>;
      identity = String(payload["sub"] ?? payload["email"] ?? "");
      displayName = String(payload["name"] ?? payload["preferred_username"] ?? "");
    } catch {
      // ignore
    }
  }

  return { accessToken, refreshToken, accessTokenExpiry, identity, displayName };
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
