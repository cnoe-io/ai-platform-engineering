/**
 * GET /api/integrations/webex/start
 *
 * Initiates the per-user Webex OAuth flow. Requires an authenticated
 * session (NextAuth). Builds the Webex authorize URL with a signed state
 * binding the flow to the current user, then 302s the browser to Webex.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api-middleware';
import { buildAuthorizeUrl, WebexOauthError } from '@/lib/webex-oauth';

export async function GET(request: NextRequest) {
  try {
    const { user } = await getAuthenticatedUser(request);
    const url = buildAuthorizeUrl(user.email);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    if (err instanceof WebexOauthError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    const message = err instanceof Error ? err.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
