// Debug endpoint to check auth status and admin role
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, REQUIRED_GROUP, REQUIRED_ADMIN_GROUP } from '@/lib/auth-config';
import { getCollection } from '@/lib/mongodb';
import type { User } from '@/types/mongodb';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({
      authenticated: false,
      message: 'No session found'
    });
  }

  // Check MongoDB role
  let mongoRole = null;
  try {
    if (session.user?.email) {
      const users = await getCollection<User>('users');
      const dbUser = await users.findOne({ email: session.user.email } as any);
      mongoRole = dbUser?.metadata?.role || null;
    }
  } catch (error: any) {
    console.error('[Debug] MongoDB check failed:', error.message);
  }

  return NextResponse.json({
    authenticated: true,
    session: {
      email: session.user?.email,
      name: session.user?.name,
      role: session.role,
      // Note: groups removed from session to prevent oversized cookies
      isAuthorized: session.isAuthorized,
    },
    config: {
      requiredGroup: REQUIRED_GROUP,
      requiredAdminGroup: REQUIRED_ADMIN_GROUP,
    },
    checks: {
      // Note: groups removed from session to prevent oversized cookies
      // Check authorization via session.isAuthorized instead
      hasRequiredGroup: session.isAuthorized,
      hasAdminGroup: session.role === 'admin',
      sessionRole: session.role,
      mongoRole,
      finalIsAdmin: session.role === 'admin' || mongoRole === 'admin',
    }
  });
}
