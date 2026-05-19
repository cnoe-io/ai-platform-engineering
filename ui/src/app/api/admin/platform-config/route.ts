// GET /api/admin/platform-config — read platform-wide config (any authenticated user)
// PATCH /api/admin/platform-config — update platform config (admin only)

// assisted-by claude code claude-sonnet-4-6

import { NextRequest, NextResponse } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import { withAuth, withErrorHandler, requireRbacPermission } from '@/lib/api-middleware';
import { requireResourcePermission } from '@/lib/rbac/resource-authz';

const CONFIG_ID = 'platform_settings';

function normalizeReleaseVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const version = value.trim().replace(/^v/, '');
  return version || null;
}

function announcementIdFor(version: string | null, revision: number): string {
  return `${version || 'release'}:revision-${revision}`;
}

function normalizeReleaseNotesConfig(input: any = {}) {
  const releaseVersion = normalizeReleaseVersion(input.release_version);
  const revision = Number.isFinite(Number(input.announcement_revision))
    ? Math.max(1, Math.floor(Number(input.announcement_revision)))
    : 1;
  const toastDuration = Number.isFinite(Number(input.toast_duration_ms))
    ? Math.max(0, Math.floor(Number(input.toast_duration_ms)))
    : 5000;

  return {
    enabled: input.enabled !== false,
    release_version: releaseVersion,
    announcement_revision: revision,
    announcement_id:
      typeof input.announcement_id === 'string' && input.announcement_id.trim()
        ? input.announcement_id.trim()
        : announcementIdFor(releaseVersion, revision),
    show_toast: input.show_toast === true,
    toast_duration_ms: toastDuration,
    show_migration_cta: input.show_migration_cta !== false,
  };
}

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
        release_notes: normalizeReleaseNotesConfig((doc as any)?.release_notes),
      },
    });
  });
});

export const PATCH = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, user, session) => {
    await requireRbacPermission(session, 'admin_ui', 'admin');
    await requireResourcePermission(session, {
      type: 'system_config',
      id: CONFIG_ID,
      action: 'admin',
    });

    const body = await request.json().catch(() => ({}));
    const update: Record<string, unknown> = {
      updated_at: new Date(),
      updated_by: user.email,
    };

    if (Object.prototype.hasOwnProperty.call(body, 'default_agent_id')) {
      update.default_agent_id = body.default_agent_id ?? null;
    }

    if (body.release_notes) {
      update.release_notes = normalizeReleaseNotesConfig(body.release_notes);
    }

    const col = await getCollection('platform_config');
    await col.updateOne(
      { _id: CONFIG_ID as any },
      {
        $set: update,
      },
      { upsert: true },
    );

    return NextResponse.json({
      success: true,
      data: {
        ...(Object.prototype.hasOwnProperty.call(update, 'default_agent_id')
          ? { default_agent_id: update.default_agent_id }
          : {}),
        ...(update.release_notes ? { release_notes: update.release_notes } : {}),
      },
    });
  });
});
