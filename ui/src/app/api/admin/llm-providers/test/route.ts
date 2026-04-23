/**
 * POST /api/admin/llm-providers/test
 *
 * Verifies an LLM provider's credentials by making a read-only API call to
 * the provider (typically "list models" or "describe identity"). Does not
 * invoke the model and does not incur token costs.
 *
 * Body:
 *   {
 *     provider_id: string,
 *     model_id?: string,
 *     fields?: Record<string, string>,  // optional unsaved values to test
 *   }
 *
 * If `fields` is supplied, those values REPLACE the DB-stored values for
 * the duration of the test. This lets admins click "Test" inside the
 * Configure dialog before they've saved. Env vars still win over both —
 * IaC precedence is preserved. The mask sentinel "••••••••" is ignored so
 * an unchanged password field falls back to the DB value.
 *
 * Persistence:
 *   - When `fields` is not provided (test against saved config): we persist
 *     last_test_success / last_test_detail / last_tested_at on the provider
 *     doc so the card can render the verdict across reloads.
 *   - When `fields` IS provided (dry-run test of unsaved values): we do NOT
 *     persist — those aren't the live credentials.
 *
 * Returns:
 *   { success: true,  detail: string, latency_ms, model_ok?: boolean }
 *   { success: false, detail: string, latency_ms }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { decryptSecret } from '@/lib/crypto';
import { withAuth, withErrorHandler, requireAdmin, ApiError } from '@/lib/api-middleware';
import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock';
import { PROVIDER_DEFINITIONS } from '../route';
import type { EnvelopeEncrypted } from '@/lib/crypto';
import { MASKED_SECRET } from '@/lib/crypto';

interface LLMProviderDoc {
  _id: string;
  provider_id: string;
  enabled: boolean;
  fields: Record<string, EnvelopeEncrypted | string>;
  updated_at: Date;
  last_test_success?: boolean;
  last_test_detail?: string;
  last_tested_at?: Date;
}

interface TestResult {
  success: boolean;
  detail: string;
  latency_ms: number;
  model_ok?: boolean;
}

// ---------------------------------------------------------------------------
// Effective config — merges env (IaC) over DB, like everywhere else
// ---------------------------------------------------------------------------

async function getEffectiveFields(
  providerId: string,
  override?: Record<string, string>,
): Promise<Record<string, string>> {
  const def = PROVIDER_DEFINITIONS.find(d => d.id === providerId);
  if (!def) throw new ApiError(`Unknown provider: ${providerId}`, 400);

  const fields: Record<string, string> = {};

  // Layer 1: DB values (stored; encrypted passwords decrypted in place)
  if (isMongoDBConfigured) {
    try {
      const col = await getCollection<LLMProviderDoc>('platform_config');
      const doc = await col.findOne({ _id: `llm_provider:${providerId}` as any });
      if (doc?.fields) {
        for (const field of def.fields) {
          const stored = doc.fields[field.id];
          if (!stored) continue;
          try {
            fields[field.id] = typeof stored === 'string'
              ? stored
              : decryptSecret(stored as EnvelopeEncrypted);
          } catch {
            // unreadable; treat as missing
          }
        }
      }
    } catch (err) {
      console.warn('[llm-test] DB read failed; continuing with env only:', err);
    }
  }

  // Layer 2: override (unsaved UI values from a Configure dialog). The mask
  // sentinel means "not changed" — fall back to the stored value.
  if (override) {
    for (const field of def.fields) {
      const v = override[field.id];
      if (typeof v !== 'string') continue;
      if (!v || v === MASKED_SECRET) continue;
      fields[field.id] = v;
    }
  }

  // Layer 3: env wins over both, always (IaC precedence).
  for (const field of def.fields) {
    const envVal = process.env[field.envVar];
    if (envVal) fields[field.id] = envVal;
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Per-provider credential tests
// ---------------------------------------------------------------------------

async function testAwsBedrock(fields: Record<string, string>, modelId?: string): Promise<TestResult> {
  const start = Date.now();
  const region = fields.region || 'us-east-1';
  const accessKeyId = fields.access_key_id;
  const secretAccessKey = fields.secret_access_key;

  if (!accessKeyId || !secretAccessKey) {
    return { success: false, detail: 'Missing AWS access key ID or secret access key.', latency_ms: Date.now() - start };
  }

  try {
    const client = new BedrockClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    // 1. List foundation models — smallest read op that proves cred + region + bedrock:ListFoundationModels IAM perm.
    const models = await client.send(new ListFoundationModelsCommand({}));
    const count = models.modelSummaries?.length ?? 0;

    // 2. Optional: check the requested model is actually reachable (foundation or inference profile)
    let model_ok: boolean | undefined;
    const candidate = modelId || fields.model_id;
    if (candidate) {
      const ids = new Set<string>();
      for (const m of models.modelSummaries ?? []) {
        if (m.modelId) ids.add(m.modelId);
      }
      if (!ids.has(candidate)) {
        // Check inference profiles too (cross-region, AIP). These include cross-region
        // profiles like `us.anthropic.claude-sonnet-4-20250514-v1:0` and account-owned
        // Application Inference Profiles.
        try {
          const profiles = await client.send(new ListInferenceProfilesCommand({}));
          for (const p of profiles.inferenceProfileSummaries ?? []) {
            if (p.inferenceProfileId) ids.add(p.inferenceProfileId);
            if (p.inferenceProfileArn) ids.add(p.inferenceProfileArn);
          }
        } catch {
          // ListInferenceProfiles may be denied by IAM; that's fine, we just can't confirm profiles.
        }
      }
      model_ok = ids.has(candidate);
    }

    // Success detail: keep it terse. The emerald card + "Connected" pill
    // and the "✓ Tested …" line already convey the auth verdict and
    // timestamp — no need to repeat "Authenticated in <region>".
    const detail = model_ok === false
      ? `${count} foundation models accessible — but "${candidate}" was not found. Double-check the model ID.`
      : `${count} foundation models accessible${model_ok ? ` — "${candidate}" available.` : '.'}`;

    return { success: true, detail, latency_ms: Date.now() - start, model_ok };
  } catch (err: any) {
    const code = err?.name || err?.Code || 'Unknown';
    const msg = err?.message || String(err);
    return {
      success: false,
      detail: `Bedrock test failed (${code}): ${msg.slice(0, 300)}`,
      latency_ms: Date.now() - start,
    };
  }
}

async function testOpenAIStyle(url: string, apiKey: string | undefined, modelId: string | undefined, label: string): Promise<TestResult> {
  const start = Date.now();
  if (!apiKey) {
    return { success: false, detail: `Missing API key for ${label}.`, latency_ms: Date.now() - start };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const latency_ms = Date.now() - start;
    if (res.status === 401 || res.status === 403) {
      return { success: false, detail: `${label} rejected credentials (HTTP ${res.status}).`, latency_ms };
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { success: false, detail: `${label} returned HTTP ${res.status}: ${txt.slice(0, 200)}`, latency_ms };
    }
    const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
    const ids = new Set<string>((body.data ?? []).map(m => m.id).filter((s): s is string => !!s));
    const model_ok = modelId ? ids.has(modelId) : undefined;
    // Terse: the emerald pill + "✓ Tested …" already say "connected to ${label}".
    const detail = model_ok === false
      ? `${ids.size} models accessible — but "${modelId}" was not found.`
      : `${ids.size} models accessible${model_ok ? ` — "${modelId}" available.` : '.'}`;
    return { success: true, detail, latency_ms, model_ok };
  } catch (err: any) {
    return { success: false, detail: `${label} test failed: ${err?.message?.slice(0, 200) ?? String(err)}`, latency_ms: Date.now() - start };
  }
}

async function runProviderTest(providerId: string, fields: Record<string, string>, modelId?: string): Promise<TestResult> {
  switch (providerId) {
    case 'aws-bedrock':
      return testAwsBedrock(fields, modelId);
    case 'openai':
      return testOpenAIStyle('https://api.openai.com/v1/models', fields.api_key, modelId, 'OpenAI');
    case 'groq':
      return testOpenAIStyle('https://api.groq.com/openai/v1/models', fields.api_key, modelId, 'Groq');
    case 'azure-openai': {
      // Azure lists deployments under the resource endpoint.
      const endpoint = (fields.endpoint || '').replace(/\/$/, '');
      const apiVersion = fields.api_version || '2024-02-01';
      if (!endpoint) {
        return { success: false, detail: 'Missing Azure OpenAI endpoint.', latency_ms: 0 };
      }
      return testOpenAIStyle(`${endpoint}/openai/deployments?api-version=${encodeURIComponent(apiVersion)}`, fields.api_key, modelId, 'Azure OpenAI');
    }
    case 'anthropic-claude': {
      // Anthropic exposes /v1/models since 2024-06; header flavor differs from OpenAI.
      const start = Date.now();
      const apiKey = fields.api_key;
      if (!apiKey) return { success: false, detail: 'Missing API key for Anthropic.', latency_ms: Date.now() - start };
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const latency_ms = Date.now() - start;
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          return { success: false, detail: `Anthropic returned HTTP ${res.status}: ${txt.slice(0, 200)}`, latency_ms };
        }
        const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
        const ids = new Set<string>((body.data ?? []).map(m => m.id).filter((s): s is string => !!s));
        const model_ok = modelId ? ids.has(modelId) : undefined;
        return {
          success: true,
          detail: model_ok === false
            ? `${ids.size} models accessible — but "${modelId}" was not found.`
            : `${ids.size} models accessible.`,
          latency_ms,
          model_ok,
        };
      } catch (err: any) {
        return { success: false, detail: `Anthropic test failed: ${err?.message?.slice(0, 200) ?? String(err)}`, latency_ms: Date.now() - start };
      }
    }
    default:
      return {
        success: false,
        detail: `Credential test is not yet implemented for "${providerId}". Please test manually or open an issue.`,
        latency_ms: 0,
      };
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const POST = withErrorHandler<any>(async (request: NextRequest) => {
  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const body: {
      provider_id: string;
      model_id?: string;
      fields?: Record<string, string>;
    } = await request.json();
    if (!body?.provider_id) throw new ApiError('provider_id is required', 400);

    const isDryRun = !!body.fields;
    const fields = await getEffectiveFields(body.provider_id, body.fields);
    const result = await runProviderTest(
      body.provider_id,
      fields,
      body.model_id?.trim() || undefined,
    );

    // Persist the verdict only when testing against the saved config. For
    // dry-run tests from the Configure dialog (fields in body), we don't
    // persist — those aren't the live credentials and would mis-brand the
    // card. The dialog echoes the result inline via the HTTP response.
    if (!isDryRun && isMongoDBConfigured) {
      try {
        const col = await getCollection<LLMProviderDoc>('platform_config');
        await col.updateOne(
          { _id: `llm_provider:${body.provider_id}` as any },
          {
            $set: {
              last_test_success: result.success,
              last_test_detail: result.detail,
              last_tested_at: new Date(),
            },
          },
          { upsert: false },
        );
      } catch (err) {
        // Non-fatal — fall through with the result
        console.warn('[llm-test] Failed to persist last_test fields:', err);
      }
    }

    return NextResponse.json(result);
  });
});
