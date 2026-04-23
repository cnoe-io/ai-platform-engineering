/**
 * GET /api/admin/llm-providers/env-export
 *
 * Internal endpoint called by the Python dynamic-agents backend at startup.
 * Returns ALL decrypted env var name → value pairs for DB-configured LLM providers.
 * The Python caller filters to only inject vars not already set in os.environ.
 *
 * Authentication: DYNAMIC_AGENTS_SERVICE_TOKEN (preferred) or NEXTAUTH_SECRET (fallback).
 * Must NOT be reachable from the public internet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { decryptSecret } from '@/lib/crypto';
import { PROVIDER_DEFINITIONS } from '../route';
import type { EnvelopeEncrypted } from '@/lib/crypto';

interface LLMProviderDoc {
  _id: string;
  provider_id: string;
  enabled: boolean;
  fields: Record<string, EnvelopeEncrypted | string>;
  updated_at: Date;
}

export const GET = async (request: NextRequest) => {
  // Authenticate using a dedicated service token (DYNAMIC_AGENTS_SERVICE_TOKEN).
  // This avoids reusing the master encryption secret (NEXTAUTH_SECRET) as an API
  // credential, limiting blast radius if this endpoint is somehow reached.
  //
  // Fallback order:
  //   1. DYNAMIC_AGENTS_SERVICE_TOKEN — scoped, preferred
  //   2. NEXTAUTH_SECRET — legacy fallback; logs a deprecation warning
  const authHeader = request.headers.get('Authorization');
  const dedicatedToken = process.env.DYNAMIC_AGENTS_SERVICE_TOKEN;
  const fallbackSecret = process.env.NEXTAUTH_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  // In production the dedicated service token is required — falling back to
  // NEXTAUTH_SECRET couples the master encryption key to service auth and
  // increases blast radius if this endpoint is reachable.
  if (isProduction && !dedicatedToken) {
    console.error('[env-export] DYNAMIC_AGENTS_SERVICE_TOKEN must be set in production.');
    return NextResponse.json({ error: 'Service not configured for production use.' }, { status: 503 });
  }

  let authorized = false;
  if (dedicatedToken && authHeader === `Bearer ${dedicatedToken}`) {
    authorized = true;
  } else if (!dedicatedToken && fallbackSecret && authHeader === `Bearer ${fallbackSecret}`) {
    console.warn(
      '[env-export] Authenticated via NEXTAUTH_SECRET fallback. ' +
      'Set DYNAMIC_AGENTS_SERVICE_TOKEN to a dedicated credential.'
    );
    authorized = true;
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isMongoDBConfigured) {
    return NextResponse.json({ env_vars: {} });
  }

  try {
    const col = await getCollection<LLMProviderDoc>('platform_config');
    const docs = await col.find({ _id: { $regex: /^llm_provider:/ } as any }).toArray();

    // Build env var map from DB docs, decrypting secrets
    const envVars: Record<string, string> = {};
    const enabledProviderIds: string[] = [];

    for (const doc of docs) {
      if (!doc.enabled) continue;
      const def = PROVIDER_DEFINITIONS.find(d => d.id === doc.provider_id);
      if (!def) continue;
      enabledProviderIds.push(doc.provider_id);

      for (const field of def.fields) {
        const stored = doc.fields[field.id];
        if (!stored) continue;

        let value: string;
        if (typeof stored === 'string') {
          value = stored;
        } else {
          try {
            value = decryptSecret(stored as EnvelopeEncrypted);
          } catch {
            continue; // skip if decryption fails
          }
        }

        if (value) {
          envVars[field.envVar] = value;
        }
      }
    }

    // Emit LLM_PROVIDER when we can unambiguously pick one — this is the env
    // var cnoe-agent-utils' LLMFactory reads to decide which client to build.
    // If an admin has enabled exactly one provider in the UI (the common case
    // on first setup), the consumers (supervisor, dynamic-agents) shouldn't
    // also need to hand-set LLM_PROVIDER in a Kubernetes Secret.
    //
    // When multiple providers are enabled we deliberately don't guess — the
    // caller is expected to set LLM_PROVIDER themselves (or we can add a
    // "default provider" pin in the UI later).
    if (enabledProviderIds.length === 1) {
      envVars.LLM_PROVIDER = enabledProviderIds[0];
    }

    return NextResponse.json({ env_vars: envVars });
  } catch (err) {
    console.error('[LLM env-export] Error:', err);
    return NextResponse.json({ env_vars: {} });
  }
};
