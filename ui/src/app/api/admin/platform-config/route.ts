// GET /api/admin/platform-config — read platform-wide config (any authenticated user)
// PATCH /api/admin/platform-config — update platform config (admin only)

// assisted-by claude code claude-sonnet-4-6

import { ApiError,requireRbacPermission,withAuth,withErrorHandler } from '@/lib/api-middleware';
import { getCollection } from '@/lib/mongodb';
import {
normalizePlatformDefaultAgentId,
PLATFORM_AGENT_ID_PATTERN,
PLATFORM_CONFIG_ID,
type PlatformDefaultAgentDocument,
} from '@/lib/platform-default-agent';
import {
DEFAULT_DISCOVERY_CACHE_TTL_MINUTES,
MAX_DISCOVERY_CACHE_TTL_MINUTES,
MIN_DISCOVERY_CACHE_TTL_MINUTES,
normalizeDiscoveryCacheTtlMinutes,
} from '@/lib/rbac/discovery-cache-config';
import { writeOpenFgaTuples,type OpenFgaTupleKey } from '@/lib/rbac/openfga';
import { requireResourcePermission } from '@/lib/rbac/resource-authz';
import {
createJsonResponseCacheStore,
envTtlMs,
withJsonResponseCache,
} from '@/lib/server-response-cache';
import { NextRequest,NextResponse } from 'next/server';

const platformConfigCache = createJsonResponseCacheStore();

interface PlatformConfigDoc extends PlatformDefaultAgentDocument {
  slack_victorops_escalation_agent_id?: unknown;
  release_notes?: unknown;
  discovery_cache_ttl_minutes?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeVictoropsAgentId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new ApiError('slack_victorops_escalation_agent_id must be a string or null', 400, 'INVALID_VICTOROPS_AGENT_ID');
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!PLATFORM_AGENT_ID_PATTERN.test(trimmed)) {
    throw new ApiError('slack_victorops_escalation_agent_id is not a valid OpenFGA object id', 400, 'INVALID_VICTOROPS_AGENT_ID');
  }
  return trimmed;
}

function defaultAgentTuple(agentId: string): OpenFgaTupleKey {
  return { user: 'user:*', relation: 'user', object: `agent:${agentId}` };
}

async function reconcileDefaultAgentGrant(previousAgentId: string | null, nextAgentId: string | null): Promise<void> {
  const writes = nextAgentId ? [defaultAgentTuple(nextAgentId)] : [];
  const deletes = previousAgentId && previousAgentId !== nextAgentId ? [defaultAgentTuple(previousAgentId)] : [];
  if (writes.length === 0 && deletes.length === 0) return;
  await writeOpenFgaTuples({ writes, deletes });
}

// Release notes is a single platform-wide on/off switch. The announcement
// always targets the currently deployed version, and dismissal is permanent
// per-version, so there is no version/revision/toast/CTA config to store.
function normalizeReleaseNotesConfig(input: unknown = {}) {
  const source = isRecord(input) ? input : {};
  return {
    enabled: source.enabled !== false,
  };
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  return withJsonResponseCache(request, platformConfigCache, () => getPlatformConfig(request), {
    ttlMs: envTtlMs('PLATFORM_CONFIG_CACHE_TTL_MS', 10_000),
    cacheableStatus: (status) => status === 200 || status === 403,
    maxEntries: 512,
  });
});

async function getPlatformConfig(request: NextRequest) {
  return await withAuth(request, async (_req, _user, session) => {
    await requireResourcePermission(session, {
      type: 'system_config',
      id: PLATFORM_CONFIG_ID,
      action: 'read',
    });
    const col = await getCollection<PlatformConfigDoc>('platform_config');
    const doc = await col.findOne({ _id: PLATFORM_CONFIG_ID } as never);

    const defaultAgentId = normalizePlatformDefaultAgentId(doc?.default_agent_id);
    const envFallback = process.env.DEFAULT_AGENT_ID || null;
    const discoveryTtlMinutes =
      normalizeDiscoveryCacheTtlMinutes(doc?.discovery_cache_ttl_minutes) ??
      normalizeDiscoveryCacheTtlMinutes(process.env.DISCOVERY_CACHE_TTL_MINUTES) ??
      DEFAULT_DISCOVERY_CACHE_TTL_MINUTES;

    const victoropsAgentId = normalizeVictoropsAgentId(doc?.slack_victorops_escalation_agent_id);
    const victoropsEnvFallback = process.env.SLACK_INTEGRATION_VICTOROPS_AGENT_ID || null;

    return NextResponse.json({
      success: true,
      data: {
        default_agent_id: defaultAgentId ?? envFallback,
        source: defaultAgentId ? 'db' : (envFallback ? 'env' : 'fallback'),
        slack_victorops_escalation_agent_id: victoropsAgentId ?? victoropsEnvFallback,
        slack_victorops_escalation_agent_source: victoropsAgentId ? 'db' : (victoropsEnvFallback ? 'env' : 'fallback'),
        release_notes: normalizeReleaseNotesConfig(doc?.release_notes),
        discovery_cache_ttl_minutes: discoveryTtlMinutes,
      },
    });
  });
}

export const PATCH = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, user, session) => {
    await requireRbacPermission(session, 'admin_ui', 'admin');
    await requireResourcePermission(session, {
      type: 'system_config',
      id: PLATFORM_CONFIG_ID,
      action: 'admin',
    });

    const rawBody = await request.json().catch(() => ({}));
    const body = isRecord(rawBody) ? rawBody : {};
    const update: Record<string, unknown> = {
      updated_at: new Date(),
      updated_by: user.email,
    };

    const hasDefaultAgentUpdate = Object.prototype.hasOwnProperty.call(body, 'default_agent_id');
    const nextDefaultAgentId = hasDefaultAgentUpdate ? normalizePlatformDefaultAgentId(body.default_agent_id) : null;
    if (hasDefaultAgentUpdate) update.default_agent_id = nextDefaultAgentId;

    // Slack VictorOps escalation agent (Admin → Integrations → Slack →
    // Advanced). Unlike the platform default this does NOT grant any user
    // access — it is only the agent the Slack bot queries for on-call
    // lookups — so there is no `user:*` tuple to reconcile or ack to require.
    const hasVictoropsUpdate = Object.prototype.hasOwnProperty.call(body, 'slack_victorops_escalation_agent_id');
    const nextVictoropsAgentId = hasVictoropsUpdate
      ? normalizeVictoropsAgentId(body.slack_victorops_escalation_agent_id)
      : null;
    if (hasVictoropsUpdate) update.slack_victorops_escalation_agent_id = nextVictoropsAgentId;

    if (body.release_notes) {
      update.release_notes = normalizeReleaseNotesConfig(body.release_notes);
    }

    // Slack/Webex discovery cache TTL. Accept an integer minute count.
    // `null` clears the override (= "use the default 60 min"); otherwise
    // we strictly require an integer in [MIN, MAX] so a fat-fingered
    // PATCH can't silently disable caching for everyone.
    if (Object.prototype.hasOwnProperty.call(body, 'discovery_cache_ttl_minutes')) {
      const raw = body.discovery_cache_ttl_minutes;
      if (raw === null) {
        update.discovery_cache_ttl_minutes = null;
      } else {
        const asNumber = typeof raw === 'number' ? raw : Number(raw);
        if (
          !Number.isFinite(asNumber) ||
          !Number.isInteger(asNumber) ||
          asNumber < MIN_DISCOVERY_CACHE_TTL_MINUTES ||
          asNumber > MAX_DISCOVERY_CACHE_TTL_MINUTES
        ) {
          throw new ApiError(
            `discovery_cache_ttl_minutes must be an integer between ${MIN_DISCOVERY_CACHE_TTL_MINUTES} and ${MAX_DISCOVERY_CACHE_TTL_MINUTES}`,
            400,
            'INVALID_DISCOVERY_CACHE_TTL',
          );
        }
        update.discovery_cache_ttl_minutes = asNumber;
      }
    }

    const col = await getCollection<PlatformConfigDoc>('platform_config');
    const previousDoc = hasDefaultAgentUpdate
      ? await col.findOne({ _id: PLATFORM_CONFIG_ID } as never)
      : null;
    const previousDefaultAgentId = normalizePlatformDefaultAgentId(previousDoc?.default_agent_id);
    const defaultAgentChanged = hasDefaultAgentUpdate && previousDefaultAgentId !== nextDefaultAgentId;

    // Selecting a non-null default agent grants `user:*` `can_use` on it,
    // i.e. every signed-in user can chat with that agent. Require an
    // explicit ack from the caller so scripts/curl/MCP tools can't flip
    // an agent public by accident. Clearing the default (next=null) is
    // safe — we just revoke the previous wildcard — so we don't require
    // the ack there.
    if (defaultAgentChanged && nextDefaultAgentId !== null) {
      if (body.acknowledge_public_access !== true) {
        throw new ApiError(
          'Setting a platform default agent makes it available to all signed-in users. Confirm in the UI before saving.',
          400,
          'PUBLIC_ACCESS_NOT_ACKNOWLEDGED',
        );
      }
    }

    if (hasDefaultAgentUpdate) {
      await reconcileDefaultAgentGrant(previousDefaultAgentId, nextDefaultAgentId);
      if (defaultAgentChanged) {
        // No shared audit helper exists in this codebase yet; emit a
        // structured console line so existing log shippers (loki, etc.)
        // can grep on `[AUDIT] platform_default_agent_changed`.
        console.info(
          '[AUDIT] platform_default_agent_changed',
          JSON.stringify({
            actor: user.email ?? null,
            previous: previousDefaultAgentId,
            next: nextDefaultAgentId,
            at: new Date().toISOString(),
          }),
        );
      }
    }
    await col.updateOne(
      { _id: PLATFORM_CONFIG_ID } as never,
      {
        $set: update,
      },
      { upsert: true },
    );
    platformConfigCache.responses.clear();
    platformConfigCache.inflight.clear();

    return NextResponse.json({
      success: true,
      data: {
        ...(Object.prototype.hasOwnProperty.call(update, 'default_agent_id')
          ? { default_agent_id: update.default_agent_id }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(update, 'slack_victorops_escalation_agent_id')
          ? { slack_victorops_escalation_agent_id: update.slack_victorops_escalation_agent_id }
          : {}),
        ...(update.release_notes ? { release_notes: update.release_notes } : {}),
        ...(Object.prototype.hasOwnProperty.call(update, 'discovery_cache_ttl_minutes')
          ? { discovery_cache_ttl_minutes: update.discovery_cache_ttl_minutes }
          : {}),
      },
    });
  });
});
