// Debug endpoint to check session and role
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  return NextResponse.json({
    authenticated: !!session,
    user: session?.user,
    role: session?.role,
    groups: session?.groups,
    isAuthorized: session?.isAuthorized,
    env: {
      ssoEnabled: process.env.NEXT_PUBLIC_SSO_ENABLED,
      requiredGroup: process.env.OIDC_REQUIRED_GROUP,
      requiredAdminGroup: process.env.OIDC_REQUIRED_ADMIN_GROUP,
    }
  }, { status: 200 });
}
