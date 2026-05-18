// GET /api/admin/platform-config — read platform-wide config (any authenticated user)
// PATCH /api/admin/platform-config — update platform config (admin only)

// assisted-by claude code claude-sonnet-4-6

import { NextRequest, NextResponse } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import { withAuth, withErrorHandler, requireAdmin } from '@/lib/api-middleware';
import { requireResourcePermission } from '@/lib/rbac/resource-authz';

const CONFIG_ID = 'platform_settings';

export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, _user, session) => {
    await requireResourcePermission(session, {
      type: 'system_config',
      id: CONFIG_ID,
      action: 'read',
    });
    const col = await getCollection('platform_config');
    const doc = await col.findOne({ _id: CONFIG_ID as any });

    const defaultAgentId: string | null = (doc as any)?.default_agent_id ?? null;
    const envFallback = process.env.DEFAULT_AGENT_ID || null;

    return NextResponse.json({
      success: true,
      data: {
        default_agent_id: defaultAgentId ?? envFallback,
        source: defaultAgentId ? 'db' : (envFallback ? 'env' : 'fallback'),
      },
    });
  });
});

export const PATCH = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, user, session) => {
    await requireAdmin(session);
    await requireResourcePermission(session, {
      type: 'system_config',
      id: CONFIG_ID,
      action: 'admin',
    });

    const body = await request.json().catch(() => ({}));
    const agentId: string | null = body.default_agent_id ?? null;

    const col = await getCollection('platform_config');
    await col.updateOne(
      { _id: CONFIG_ID as any },
      {
        $set: {
          default_agent_id: agentId,
          updated_at: new Date(),
          updated_by: user.email,
        },
      },
      { upsert: true },
    );

    return NextResponse.json({ success: true, data: { default_agent_id: agentId } });
  });
});
