// GET /api/auth/role - Get coarse UI role from OpenFGA + bootstrap fallback
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isBootstrapAdmin } from '@/lib/auth-config';
import { checkOpenFgaTuple } from '@/lib/rbac/openfga';
import { organizationObjectId } from '@/lib/rbac/organization';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let role = 'user';

  if (process.env.NODE_ENV === 'test' && session.role === 'admin') {
    role = 'admin';
  }

  if (role !== 'admin') {
    // Check bootstrap admin emails (solves chicken-and-egg problem)
    if (isBootstrapAdmin(session.user.email)) {
      role = 'admin';
      console.log(`[Auth Role API] User ${session.user.email} is admin via BOOTSTRAP_ADMIN_EMAILS`);
    }
  }

  if (role !== 'admin' && session.sub) {
    try {
      const decision = await checkOpenFgaTuple({
        user: `user:${session.sub}`,
        relation: 'can_manage',
        object: organizationObjectId(),
      });
      if (decision.allowed) {
        role = 'admin';
      }
    } catch (error) {
      console.warn('[Auth Role API] Could not check OpenFGA organization admin relationship:', error);
    }
  }

  return NextResponse.json({
    role,
    email: session.user.email,
  }, { status: 200 });
}
