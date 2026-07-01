/**
 * POST /api/integrations/webex/disconnect
 *
 * Removes the current user's stored Webex tokens. The Webex-side
 * authorization grant is *not* revoked (Cisco does not provide a
 * standard revocation endpoint that's reachable from this flow); the
 * tokens simply stop being used. Users who want to fully revoke should
 * also visit https://idbroker.webex.com/idb/profile#/tokens.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api-middleware';
import { deleteVendorConnection } from '@/lib/vendor-tokens';

export async function POST(request: NextRequest) {
  try {
    const { user } = await getAuthenticatedUser(request);
    await deleteVendorConnection(user.email, 'webex');
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unauthorized';
    const status = message === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
