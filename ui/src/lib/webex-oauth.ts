/**
 * Webex OAuth 2.0 helper.
 *
 * Used by:
 *   - /api/integrations/webex/start    (build authorize URL with PKCE state)
 *   - /api/integrations/webex/callback (exchange code → tokens)
 *
 * Refresh is performed lazily by the backend at MCP connection time
 * (see ai_platform_engineering/dynamic_agents/.../vendor_tokens.py); the
 * UI exposes a refresh helper for reconnect flows.
 */

import crypto from 'node:crypto';

export const WEBEX_AUTHORIZE_URL = 'https://webexapis.com/v1/authorize';
export const WEBEX_TOKEN_URL = 'https://webexapis.com/v1/access_token';

/**
 * Default scopes for Pam (pod meeting assistant). Includes the full set
 * required by Cisco's Webex Meetings MCP (`mcp.webexapis.com/mcp/webex-meeting`).
 *
 *   spark:mcp                   — required for any Webex MCP server
 *   meeting:schedules_read      — list/get meetings
 *   meeting:schedules_write     — create/update meetings (Pam doesn't need v1, but cheap to include)
 *   meeting:participants_read   — get participant list
 *   meeting:transcripts_read    — list and download transcripts
 *   meeting:summaries_read      — Webex AI Assistant summaries (when available)
 *   meeting:recordings_read     — recording metadata
 *   spark:people_read           — resolve owners → email/person_id
 *   spark:rooms_read            — for messaging MCP if also user_oauth'd later
 *   spark:messages_write        — same
 */
export const WEBEX_DEFAULT_SCOPES = [
  'spark:mcp',
  'meeting:schedules_read',
  'meeting:schedules_write',
  'meeting:participants_read',
  'meeting:transcripts_read',
  'meeting:summaries_read',
  'meeting:recordings_read',
  'spark:people_read',
];

export interface WebexOauthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export class WebexOauthError extends Error {}

export function getWebexOauthConfig(): WebexOauthConfig {
  const clientId = process.env.WEBEX_OAUTH_CLIENT_ID;
  const clientSecret = process.env.WEBEX_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.WEBEX_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new WebexOauthError(
      'Webex OAuth is not configured. Set WEBEX_OAUTH_CLIENT_ID, ' +
        'WEBEX_OAUTH_CLIENT_SECRET, and WEBEX_OAUTH_REDIRECT_URI on the UI service.',
    );
  }
  const scopes = (process.env.WEBEX_OAUTH_SCOPES || WEBEX_DEFAULT_SCOPES.join(' '))
    .split(/\s+/)
    .filter(Boolean);
  return { clientId, clientSecret, redirectUri, scopes };
}

/**
 * Build a signed state token binding the OAuth callback to a specific user.
 * We use HMAC over `${userEmail}|${nonce}|${expiresAt}` keyed on
 * NEXTAUTH_SECRET so we don't need a server-side state cache.
 */
export function buildState(userEmail: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new WebexOauthError('NEXTAUTH_SECRET is required to sign OAuth state');
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
  const payload = `${userEmail.toLowerCase()}|${nonce}|${expiresAt}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

export function verifyState(state: string): { userEmail: string } {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new WebexOauthError('NEXTAUTH_SECRET is required to verify OAuth state');
  let decoded: string;
  try {
    decoded = Buffer.from(state, 'base64url').toString('utf8');
  } catch {
    throw new WebexOauthError('Malformed OAuth state');
  }
  const parts = decoded.split('|');
  if (parts.length !== 4) throw new WebexOauthError('Malformed OAuth state');
  const [userEmail, nonce, expiresAtStr, sig] = parts;
  const payload = `${userEmail}|${nonce}|${expiresAtStr}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new WebexOauthError('OAuth state signature mismatch');
  }
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    throw new WebexOauthError('OAuth state expired; please retry');
  }
  return { userEmail };
}

export function buildAuthorizeUrl(userEmail: string): string {
  const cfg = getWebexOauthConfig();
  const url = new URL(WEBEX_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', cfg.scopes.join(' '));
  url.searchParams.set('state', buildState(userEmail));
  return url.toString();
}

export interface WebexTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<WebexTokenResponse> {
  const cfg = getWebexOauthConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: cfg.redirectUri,
  });
  const resp = await fetch(WEBEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new WebexOauthError(`Webex token exchange failed: HTTP ${resp.status} ${text}`);
  }
  return (await resp.json()) as WebexTokenResponse;
}

export async function refreshWebexTokens(refreshToken: string): Promise<WebexTokenResponse> {
  const cfg = getWebexOauthConfig();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
  });
  const resp = await fetch(WEBEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new WebexOauthError(`Webex token refresh failed: HTTP ${resp.status} ${text}`);
  }
  return (await resp.json()) as WebexTokenResponse;
}
