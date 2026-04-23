/**
 * GET/PATCH /api/admin/feature-flags
 *
 * Manages feature-flag toggles for platform services.
 * Each flag has:
 *   - envVar: the environment variable that locks it when set
 *   - default: the built-in default when neither env nor DB is set
 *
 * Priority: env var (locked) > DB value > built-in default
 *
 * PATCH only updates flags that are not locked by env vars.
 * After save the caller should reload the page so layout.tsx
 * re-injects the updated config into window.__APP_CONFIG__.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdmin,
} from '@/lib/api-middleware';

// ---------------------------------------------------------------------------
// Flag definitions
// ---------------------------------------------------------------------------

export interface FlagDefinition {
  id: string;
  label: string;
  description: string;
  envVar: string;           // env var that locks this flag when set
  defaultValue: boolean;    // built-in default when nothing else is configured
}

export const FLAG_DEFINITIONS: FlagDefinition[] = [
  {
    id: 'sso_enabled',
    label: 'OIDC / SSO',
    description: 'Enable Single Sign-On via OIDC. Configure the provider in the OIDC Configuration tab.',
    envVar: 'SSO_ENABLED',
    defaultValue: false,
  },
  {
    id: 'rag_enabled',
    label: 'RAG / Knowledge Bases',
    description: 'Enable the RAG server and Knowledge Bases feature.',
    envVar: 'RAG_ENABLED',
    defaultValue: true,
  },
  {
    id: 'dynamic_agents_enabled',
    label: 'Custom Agents',
    description: 'Enable the Custom Agents builder and dynamic agent runtime.',
    envVar: 'DYNAMIC_AGENTS_ENABLED',
    defaultValue: true,
  },
];

// MongoDB doc shape
interface FeatureFlagsDoc {
  _id: string;
  flags: Record<string, boolean>;
  updated_at: Date;
}

const DOC_ID = 'feature_flags';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve whether a flag is locked by an env var and what its current value is. */
function resolveFlag(def: FlagDefinition, dbFlags: Record<string, boolean>): {
  value: boolean;
  source: 'env' | 'db' | 'default';
  locked: boolean;
  envValue: boolean | null;
} {
  const rawEnv = process.env[def.envVar];

  // Env var explicitly set → locked
  if (rawEnv !== undefined) {
    // For RAG, the env check is "!== 'false'" (enabled by default)
    // For others it's "=== 'true'"
    const envValue = def.defaultValue
      ? rawEnv !== 'false'
      : rawEnv === 'true';
    return { value: envValue, source: 'env', locked: true, envValue };
  }

  // DB has a value
  if (def.id in dbFlags) {
    return { value: dbFlags[def.id], source: 'db', locked: false, envValue: null };
  }

  // Fall back to default
  return { value: def.defaultValue, source: 'default', locked: false, envValue: null };
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    let dbFlags: Record<string, boolean> = {};

    if (isMongoDBConfigured) {
      try {
        const col = await getCollection<FeatureFlagsDoc>('platform_config');
        const doc = await col.findOne({ _id: DOC_ID as any });
        dbFlags = doc?.flags ?? {};
      } catch { /* ignore — use defaults */ }
    }

    // Also pull sso_enabled from oidc_config for consistency
    if (!('sso_enabled' in dbFlags) && isMongoDBConfigured) {
      try {
        const col = await getCollection<{ enabled?: boolean }>('platform_config');
        const oidcDoc = await col.findOne({ _id: 'oidc_config' as any });
        if (oidcDoc?.enabled !== undefined) {
          dbFlags['sso_enabled'] = oidcDoc.enabled;
        }
      } catch { /* ignore */ }
    }

    const flags = FLAG_DEFINITIONS.map((def) => ({
      ...def,
      ...resolveFlag(def, dbFlags),
    }));

    return successResponse({ flags });
  });
});

// ---------------------------------------------------------------------------
// PATCH — update one or more flags (only non-locked ones)
// ---------------------------------------------------------------------------

export const PATCH = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const body: Record<string, boolean> = await request.json();

    if (!isMongoDBConfigured) {
      // Can't persist, but return what would have been set for UI feedback
      return successResponse({ updated: [], note: 'MongoDB not configured — changes not persisted' });
    }

    // Load existing DB flags
    const col = await getCollection<FeatureFlagsDoc>('platform_config');
    const existing = await col.findOne({ _id: DOC_ID as any });
    const dbFlags: Record<string, boolean> = existing?.flags ?? {};

    const updated: string[] = [];

    for (const [flagId, value] of Object.entries(body)) {
      // Reject non-boolean values — prevents malformed data in MongoDB
      if (typeof value !== 'boolean') {
        return NextResponse.json(
          { error: `Invalid value for flag "${flagId}": must be a boolean.` },
          { status: 400 },
        );
      }
      const def = FLAG_DEFINITIONS.find((d) => d.id === flagId);
      if (!def) continue;

      const resolved = resolveFlag(def, dbFlags);
      if (resolved.locked) continue; // never override env vars

      // Special case: sso_enabled syncs to oidc_config too
      if (flagId === 'sso_enabled') {
        await col.updateOne(
          { _id: 'oidc_config' as any },
          { $set: { enabled: value, updated_at: new Date() } },
          { upsert: true },
        );
      }

      dbFlags[flagId] = value;
      updated.push(flagId);
    }

    await col.replaceOne(
      { _id: DOC_ID as any },
      { flags: dbFlags, updated_at: new Date() } as any,
      { upsert: true },
    );

    return successResponse({ updated });
  });
});
