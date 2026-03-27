// GET /api/auth/role - Get user role with MongoDB + bootstrap fallback
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isBootstrapAdmin } from '@/lib/auth-config';
import { getCollection } from '@/lib/mongodb';
import type { User } from '@/types/mongodb';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let role = session.role || 'user';

  if (role !== 'admin') {
    // Check bootstrap admin emails (solves chicken-and-egg problem)
    if (isBootstrapAdmin(session.user.email)) {
      role = 'admin';
      console.log(`[Auth Role API] User ${session.user.email} is admin via BOOTSTRAP_ADMIN_EMAILS`);
    }
  }

  // Fallback: Check MongoDB user profile if not admin via OIDC or bootstrap
  if (role !== 'admin') {
    try {
      const users = await getCollection<User>('users');
      const dbUser = await users.findOne({ email: session.user.email });

      if (dbUser?.metadata?.role === 'admin') {
        role = 'admin';
        console.log(`[Auth Role API] User ${session.user.email} is admin via MongoDB profile`);
      }
    } catch (error) {
      // MongoDB not available - continue with OIDC role
      console.warn('[Auth Role API] Could not check MongoDB for admin role:', error);
    }
  }

  return NextResponse.json({
    role,
    email: session.user.email,
  }, { status: 200 });
}
