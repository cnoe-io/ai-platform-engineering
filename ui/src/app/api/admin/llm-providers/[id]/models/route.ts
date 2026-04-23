/**
 * GET /api/admin/llm-providers/:id/models
 *
 * Enumerates models currently reachable via a configured LLM provider.
 * Used by the "Add Custom Model" dialog to show an autocomplete list
 * backed by the provider's live API (foundation models + inference
 * profiles for Bedrock, /v1/models for OpenAI/Anthropic/Groq, deployments
 * for Azure OpenAI).
 *
 * Credential resolution mirrors /api/admin/llm-providers/test:
 *   env vars → DB doc, with env always winning.
 *
 * Response:
 *   { success: true, models: Array<{ id, name?, provider_source?: 'foundation' | 'profile' | 'api' }> }
 *   { success: false, error: string }
 *
 * This endpoint is read-only and does not mutate provider docs. It is
 * admin-only (same auth as the sibling provider endpoints).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { decryptSecret } from '@/lib/crypto';
import { withAuth, withErrorHandler, requireAdmin, ApiError } from '@/lib/api-middleware';
import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock';
import { PROVIDER_DEFINITIONS } from '../../route';
import type { EnvelopeEncrypted } from '@/lib/crypto';

interface LLMProviderDoc {
  _id: string;
  provider_id: string;
  enabled: boolean;
  fields: Record<string, EnvelopeEncrypted | string>;
  updated_at: Date;
}

interface ModelEntry {
  id: string;
  name?: string;
  /** Where this row came from on the provider side — helpful for Bedrock to
   *  distinguish foundation model IDs from inference profile IDs since both
   *  are valid `model_id` inputs to ChatBedrock but behave differently. */
  source?: 'foundation' | 'profile' | 'api';
}

async function getEffectiveFields(providerId: string): Promise<Record<string, string>> {
  const def = PROVIDER_DEFINITIONS.find(d => d.id === providerId);
  if (!def) throw new ApiError(`Unknown provider: ${providerId}`, 400);

  const fields: Record<string, string> = {};

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
      console.warn('[llm-models] DB read failed; continuing with env only:', err);
    }
  }

  for (const field of def.fields) {
    const envVal = process.env[field.envVar];
    if (envVal) fields[field.id] = envVal;
  }

  return fields;
}

async function listBedrockModels(fields: Record<string, string>): Promise<ModelEntry[]> {
  const region = fields.region || 'us-east-1';
  const accessKeyId = fields.access_key_id;
  const secretAccessKey = fields.secret_access_key;
  if (!accessKeyId || !secretAccessKey) {
    throw new ApiError('Missing AWS access key ID or secret access key.', 400);
  }

  const client = new BedrockClient({ region, credentials: { accessKeyId, secretAccessKey } });
  const out: ModelEntry[] = [];

  // Foundation models
  const foundation = await client.send(new ListFoundationModelsCommand({}));
  for (const m of foundation.modelSummaries ?? []) {
    if (m.modelId) out.push({ id: m.modelId, name: m.modelName || m.modelId, source: 'foundation' });
  }

  // Inference profiles (cross-region and AIPs). IAM may deny this — treat as non-fatal.
  try {
    const profiles = await client.send(new ListInferenceProfilesCommand({}));
    for (const p of profiles.inferenceProfileSummaries ?? []) {
      const id = p.inferenceProfileId || p.inferenceProfileArn;
      if (id) out.push({ id, name: p.inferenceProfileName || id, source: 'profile' });
    }
  } catch (err: any) {
    console.info('[llm-models] Bedrock ListInferenceProfiles denied or unavailable:', err?.name ?? err?.message ?? err);
  }

  return out;
}

async function listOpenAIStyle(url: string, apiKey: string | undefined, label: string): Promise<ModelEntry[]> {
  if (!apiKey) throw new ApiError(`Missing API key for ${label}.`, 400);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new ApiError(`${label} returned HTTP ${res.status}: ${txt.slice(0, 200)}`, res.status < 500 ? 400 : 502);
    }
    const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
    return (body.data ?? [])
      .filter((m): m is { id: string } => !!m.id)
      .map(m => ({ id: m.id, source: 'api' as const }));
  } finally {
    clearTimeout(timer);
  }
}

async function listAnthropicModels(apiKey: string | undefined): Promise<ModelEntry[]> {
  if (!apiKey) throw new ApiError('Missing API key for Anthropic.', 400);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new ApiError(`Anthropic returned HTTP ${res.status}: ${txt.slice(0, 200)}`, res.status < 500 ? 400 : 502);
    }
    const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string; display_name?: string }> };
    return (body.data ?? [])
      .filter((m): m is { id: string; display_name?: string } => !!m.id)
      .map(m => ({ id: m.id, name: m.display_name || m.id, source: 'api' as const }));
  } finally {
    clearTimeout(timer);
  }
}

async function listModelsForProvider(providerId: string, fields: Record<string, string>): Promise<ModelEntry[]> {
  switch (providerId) {
    case 'aws-bedrock':
      return listBedrockModels(fields);
    case 'openai':
      return listOpenAIStyle('https://api.openai.com/v1/models', fields.api_key, 'OpenAI');
    case 'groq':
      return listOpenAIStyle('https://api.groq.com/openai/v1/models', fields.api_key, 'Groq');
    case 'anthropic-claude':
      return listAnthropicModels(fields.api_key);
    case 'azure-openai': {
      const endpoint = (fields.endpoint || '').replace(/\/$/, '');
      const apiVersion = fields.api_version || '2024-02-01';
      if (!endpoint) throw new ApiError('Missing Azure OpenAI endpoint.', 400);
      return listOpenAIStyle(
        `${endpoint}/openai/deployments?api-version=${encodeURIComponent(apiVersion)}`,
        fields.api_key,
        'Azure OpenAI',
      );
    }
    default:
      throw new ApiError(`Listing models is not implemented for provider "${providerId}".`, 501);
  }
}

export const GET = withErrorHandler<any>(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const { id: providerId } = await context.params;
    if (!providerId) throw new ApiError('provider id required in URL', 400);

    const fields = await getEffectiveFields(providerId);

    try {
      const models = await listModelsForProvider(providerId, fields);
      // Dedupe by id and sort by friendly name so the dropdown is predictable.
      const seen = new Set<string>();
      const unique = models.filter(m => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
      unique.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
      return NextResponse.json({ success: true, models: unique });
    } catch (err: any) {
      const status = err instanceof ApiError ? err.statusCode : 500;
      const detail = err?.message?.slice(0, 400) ?? String(err);
      return NextResponse.json({ success: false, error: detail }, { status });
    }
  });
});
