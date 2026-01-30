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
    const users = await getCollection<User>('users');
    const dbUser = await users.findOne({ email: session.user?.email });
    mongoRole = dbUser?.metadata?.role || null;
  } catch (error: any) {
    console.error('[Debug] MongoDB check failed:', error.message);
  }

  return NextResponse.json({
    authenticated: true,
    session: {
      email: session.user?.email,
      name: session.user?.name,
      role: session.role,
      groups: session.groups,
      isAuthorized: session.isAuthorized,
    },
    config: {
      requiredGroup: REQUIRED_GROUP,
      requiredAdminGroup: REQUIRED_ADMIN_GROUP,
    },
    checks: {
      hasRequiredGroup: session.groups?.includes(REQUIRED_GROUP),
      hasAdminGroup: session.groups?.includes(REQUIRED_ADMIN_GROUP),
      sessionRole: session.role,
      mongoRole,
      finalIsAdmin: session.role === 'admin' || mongoRole === 'admin',
    }
  });
}
