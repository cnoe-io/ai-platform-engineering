/**
 * GET /api/integrations/webex/callback
 *
 * Webex redirects here after the user grants consent. We:
 *   1. Verify the signed state binds back to a user.
 *   2. Exchange the authorization code for access + refresh tokens.
 *   3. Persist them in the ``vendor_connections`` Mongo collection so
 *      the backend's MCP client can mint per-user bearers at runtime.
 *   4. Redirect the browser back to the Settings → Integrations page.
 *
 * This route does not require an active session — the signed ``state``
 * is the only auth needed (it was minted from the user's session at the
 * /start step). This keeps it usable from any browser that holds the
 * Webex consent screen open across an SSO refresh.
 */

import { NextRequest, NextResponse } from 'next/server';

import {
  exchangeCodeForTokens,
  verifyState,
  WebexOauthError,
} from '@/lib/webex-oauth';
import { upsertVendorConnection } from '@/lib/vendor-tokens';

const SETTINGS_PAGE = '/settings/integrations';

function redirectWithStatus(
  request: NextRequest,
  outcome: 'success' | 'error',
  message?: string,
) {
  const url = new URL(SETTINGS_PAGE, request.url);
  url.searchParams.set('webex', outcome);
  if (message) url.searchParams.set('message', message);
  return NextResponse.redirect(url, 302);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  if (error) {
    return redirectWithStatus(request, 'error', `Webex denied authorization: ${error}`);
  }
  if (!code || !state) {
    return redirectWithStatus(request, 'error', 'Missing code or state in callback');
  }

  let userEmail: string;
  try {
    ({ userEmail } = verifyState(state));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid state';
    return redirectWithStatus(request, 'error', msg);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const scopes = tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : [];
    await upsertVendorConnection(userEmail, 'webex', {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      scopes,
    });
    return redirectWithStatus(request, 'success');
  } catch (err) {
    const msg =
      err instanceof WebexOauthError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Unknown error during token exchange';
    return redirectWithStatus(request, 'error', msg);
  }
}
