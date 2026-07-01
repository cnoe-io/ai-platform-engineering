/**
 * GET /api/integrations/webex/status
 *
 * Returns the current user's Webex connection status. Does NOT return the
 * access token — only metadata the UI needs to render the integrations
 * card.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api-middleware';
import { getVendorConnection } from '@/lib/vendor-tokens';

export async function GET(request: NextRequest) {
  try {
    const { user } = await getAuthenticatedUser(request);
    const conn = await getVendorConnection(user.email, 'webex');
    if (!conn) {
      return NextResponse.json({ connected: false });
    }
    return NextResponse.json({
      connected: true,
      expiresAt: conn.expiresAt,
      scopes: conn.scopes,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
