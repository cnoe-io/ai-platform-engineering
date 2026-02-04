// GET /api/auth/role - Get user role with MongoDB fallback
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { getCollection } from '@/lib/mongodb';
import type { User } from '@/types/mongodb';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.email) {
    return NextResponse.json({ role: 'user' }, { status: 200 });
  }

  let role = session.role || 'user';

  // Fallback: Check MongoDB user profile if not admin via OIDC
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
    // Note: groups are extracted client-side from idToken to avoid oversized cookies
  }, { status: 200 });
}
