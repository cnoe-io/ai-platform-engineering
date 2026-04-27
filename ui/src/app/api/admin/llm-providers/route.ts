/**
 * GET/POST/PUT/DELETE /api/admin/llm-providers
 *
 * Manages LLM provider configurations (API keys, endpoints, etc.).
 *
 * Design: env-first, DB-extends.
 *   - Env vars (set by IaC / k8s secrets) always take precedence. Fields backed
 *     by a set env var are shown read-only in the UI and skipped on POST/PUT so
 *     the DB never accumulates a value that would silently be ignored at runtime.
 *   - UI-configured values are stored envelope-encrypted in MongoDB
 *     platform_config and fill the gaps for any vars not set in the environment.
 *   - At dynamic-agents startup the env-export endpoint is called and DB values
 *     are injected into os.environ only for keys that are not already set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  errorResponse,
  requireAdmin,
  ApiError,
} from '@/lib/api-middleware';
import { encryptSecret, decryptSecret, MASKED_SECRET, type EnvelopeEncrypted } from '@/lib/crypto';
import { getServerConfig } from '@/lib/config';

/**
 * Notify the Dynamic Agents backend to hot-reload LLM provider credentials.
 * Called after any POST/PUT that persists new credential values to the DB.
 * Fire-and-forget: failures are logged but never surface as errors to the caller.
 */
async function notifyDynamicAgentsRefresh(): Promise<void> {
  try {
    const config = getServerConfig();
    const daUrl = config.dynamicAgentsUrl;
    const token = process.env.DYNAMIC_AGENTS_SERVICE_TOKEN;
    if (!daUrl || !token) return;

    const res = await fetch(`${daUrl}/api/v1/admin/refresh-credentials`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn(`[llm-providers] DA refresh-credentials responded ${res.status}`);
    }
  } catch (err) {
    console.warn('[llm-providers] Could not notify DA to refresh credentials:', err);
  }
}

// ---------------------------------------------------------------------------
// Provider definitions — fields, env var mappings, display metadata
// ---------------------------------------------------------------------------

export interface ProviderField {
  id: string;
  label: string;
  type: 'password' | 'text';
  envVar: string;
  required: boolean;
  placeholder?: string;
  /** If true, the value is shown in plain text when sourced from env (not masked) */
  showEnvValue?: boolean;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  description: string;
  fields: ProviderField[];
}

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: 'anthropic-claude',
    name: 'Anthropic Claude',
    description: 'Claude 3.5, Claude 3 family via Anthropic API',
    fields: [
      { id: 'api_key', label: 'API Key', type: 'password', envVar: 'ANTHROPIC_API_KEY', required: true, placeholder: 'sk-ant-...' },
      { id: 'model_name', label: 'Default Model Name', type: 'text', envVar: 'ANTHROPIC_MODEL_NAME', required: false, placeholder: 'claude-3-5-sonnet-20241022', showEnvValue: true },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4, o1 and other OpenAI models',
    fields: [
      { id: 'api_key', label: 'API Key', type: 'password', envVar: 'OPENAI_API_KEY', required: true, placeholder: 'sk-...' },
      { id: 'model_name', label: 'Default Model Name', type: 'text', envVar: 'OPENAI_MODEL_NAME', required: false, placeholder: 'gpt-4o', showEnvValue: true },
      { id: 'endpoint', label: 'Custom Endpoint (optional)', type: 'text', envVar: 'OPENAI_ENDPOINT', required: false, placeholder: 'https://api.openai.com/v1', showEnvValue: true },
    ],
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    description: 'OpenAI models hosted on Microsoft Azure',
    fields: [
      { id: 'api_key', label: 'API Key', type: 'password', envVar: 'AZURE_OPENAI_API_KEY', required: true },
      { id: 'endpoint', label: 'Endpoint', type: 'text', envVar: 'AZURE_OPENAI_ENDPOINT', required: true, placeholder: 'https://your-resource.openai.azure.com/', showEnvValue: true },
      { id: 'deployment', label: 'Deployment Name', type: 'text', envVar: 'AZURE_OPENAI_DEPLOYMENT', required: true, showEnvValue: true },
      { id: 'api_version', label: 'API Version', type: 'text', envVar: 'AZURE_OPENAI_API_VERSION', required: true, placeholder: '2024-02-01', showEnvValue: true },
    ],
  },
  {
    id: 'aws-bedrock',
    name: 'AWS Bedrock',
    description: 'Claude, Llama, Titan and other models via AWS Bedrock',
    fields: [
      { id: 'access_key_id', label: 'Access Key ID', type: 'text', envVar: 'AWS_ACCESS_KEY_ID', required: true, showEnvValue: true },
      { id: 'secret_access_key', label: 'Secret Access Key', type: 'password', envVar: 'AWS_SECRET_ACCESS_KEY', required: true },
      { id: 'region', label: 'Region', type: 'text', envVar: 'AWS_REGION', required: true, placeholder: 'us-east-1', showEnvValue: true },
      { id: 'model_id', label: 'Model ID (inference profile)', type: 'text', envVar: 'AWS_BEDROCK_MODEL_ID', required: false, placeholder: 'us.anthropic.claude-sonnet-4-6', showEnvValue: true },
    ],
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    description: 'Gemini 1.5 Pro, Flash and other Google AI models',
    fields: [
      { id: 'api_key', label: 'API Key', type: 'password', envVar: 'GOOGLE_API_KEY', required: true },
      { id: 'model_name', label: 'Model Name', type: 'text', envVar: 'GOOGLE_GEMINI_MODEL_NAME', required: false, placeholder: 'gemini-2.0-flash', showEnvValue: true },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference for Llama, Mixtral and other open models',
    fields: [
      { id: 'api_key', label: 'API Key', type: 'password', envVar: 'GROQ_API_KEY', required: true },
      { id: 'model_name', label: 'Model Name', type: 'text', envVar: 'GROQ_MODEL_NAME', required: false, placeholder: 'llama-3.3-70b-versatile', showEnvValue: true },
    ],
  },
];

// MongoDB document shape
interface LLMProviderDoc {
  _id: string;           // e.g. "llm_provider:anthropic-claude"
  provider_id: string;   // e.g. "anthropic-claude"
  enabled: boolean;
  fields: Record<string, EnvelopeEncrypted | string>; // encrypted sensitive fields, plain text for non-sensitive
  updated_at: Date;
  // Populated by /api/admin/llm-providers/test after a manual test.
  // Credential changes (POST/PUT) clear these so the UI never displays a
  // stale "Authenticated" badge for creds that haven't been re-tested.
  last_test_success?: boolean;
  last_test_detail?: string;
  last_tested_at?: Date;
}

const COLLECTION = 'platform_config';
const docId = (providerId: string) => `llm_provider:${providerId}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the raw (un-masked) value of a field from a DB doc. */
function decryptField(raw: EnvelopeEncrypted | string): string {
  if (typeof raw === 'string') return raw;
  try {
    return decryptSecret(raw as EnvelopeEncrypted);
  } catch {
    return '';
  }
}

/** Mask a field value for API responses. */
function maskField(raw: EnvelopeEncrypted | string | undefined, type: 'password' | 'text'): string {
  if (!raw) return '';
  if (type === 'text') return decryptField(raw);
  return MASKED_SECRET;
}

/** Build the merged provider status combining env vars + DB entry. */
function buildProviderStatus(
  def: ProviderDefinition,
  dbDoc: LLMProviderDoc | null,
) {
  // Check which fields are configured from environment
  const envConfigured: Record<string, boolean> = {};
  // For non-secret fields (showEnvValue: true), expose the actual env value
  const envValues: Record<string, string> = {};
  let anyEnv = false;
  for (const field of def.fields) {
    const envVal = process.env[field.envVar];
    const hasEnv = !!envVal;
    envConfigured[field.id] = hasEnv;
    if (hasEnv) {
      anyEnv = true;
      if (field.showEnvValue && envVal) {
        envValues[field.id] = envVal; // show plain text for non-secrets
      }
    }
  }

  // Check which fields are configured in DB
  const dbConfigured: Record<string, boolean> = {};
  const maskedDbValues: Record<string, string> = {};
  let anyDb = false;
  if (dbDoc?.fields) {
    for (const field of def.fields) {
      const val = dbDoc.fields[field.id];
      if (val) {
        dbConfigured[field.id] = true;
        maskedDbValues[field.id] = maskField(val, field.type);
        anyDb = true;
      }
    }
  }

  const source: 'env' | 'db' | 'both' | 'none' =
    anyEnv && anyDb ? 'both' : anyEnv ? 'env' : anyDb ? 'db' : 'none';

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    fields: def.fields,
    source,
    enabled: dbDoc?.enabled ?? anyEnv,
    // Field values for display:
    //   - password-type env fields → masked
    //   - text-type env fields with showEnvValue → plain text (non-secret, useful info)
    //   - DB fields → masked (always, regardless of type)
    configured_fields: {
      ...Object.fromEntries(
        def.fields
          .filter(f => envConfigured[f.id])
          .map(f => [f.id, f.showEnvValue && envValues[f.id] ? envValues[f.id] : MASKED_SECRET])
      ),
      ...maskedDbValues,
    },
    env_configured: envConfigured,
    db_configured: dbConfigured,
    updated_at: dbDoc?.updated_at ?? null,
    // Last credential-test verdict — drives the "Authenticated" / "Test failed"
    // badge. Only set after an admin clicks Test; not a live liveness check.
    last_test_success: (dbDoc as any)?.last_test_success ?? null,
    last_test_detail: (dbDoc as any)?.last_test_detail ?? null,
    last_tested_at: (dbDoc as any)?.last_tested_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET — list all providers with merged env+DB status
// ---------------------------------------------------------------------------

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return errorResponse('MongoDB not configured', 503, 'MONGODB_NOT_CONFIGURED');
  }

  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const col = await getCollection<LLMProviderDoc>(COLLECTION);

    // Load all DB docs for LLM providers in one query
    const docs = await col
      .find({ _id: { $regex: /^llm_provider:/ } as any })
      .toArray();
    const docMap = new Map(docs.map(d => [d.provider_id, d]));

    const providers = PROVIDER_DEFINITIONS.map(def =>
      buildProviderStatus(def, docMap.get(def.id) ?? null)
    );

    return successResponse({ providers, definitions: PROVIDER_DEFINITIONS });
  });
});

// ---------------------------------------------------------------------------
// POST — create or replace a provider DB config
// ---------------------------------------------------------------------------

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return errorResponse('MongoDB not configured', 503, 'MONGODB_NOT_CONFIGURED');
  }

  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const body: { provider_id: string; fields: Record<string, string>; enabled?: boolean } =
      await request.json();

    const def = PROVIDER_DEFINITIONS.find(d => d.id === body.provider_id);
    if (!def) throw new ApiError(`Unknown provider: ${body.provider_id}`, 400);

    // Encrypt sensitive fields, store plain text for text fields.
    // Env vars trump DB (same precedence as PUT), so we never persist a
    // value that would be silently ignored at runtime.
    const storedFields: Record<string, EnvelopeEncrypted | string> = {};
    for (const field of def.fields) {
      const val = body.fields?.[field.id];
      if (!val) continue;
      if (process.env[field.envVar]) continue; // env-locked; IaC wins
      if (field.type === 'password') {
        storedFields[field.id] = encryptSecret(val);
      } else {
        storedFields[field.id] = val;
      }
    }

    const col = await getCollection<LLMProviderDoc>(COLLECTION);
    const id = docId(body.provider_id);
    const doc: LLMProviderDoc = {
      _id: id as any,
      provider_id: body.provider_id,
      enabled: body.enabled !== false,
      fields: storedFields,
      updated_at: new Date(),
    };

    await col.replaceOne({ _id: id as any }, doc, { upsert: true });

    // Notify DA to hot-reload the new credentials (fire-and-forget).
    void notifyDynamicAgentsRefresh();

    return successResponse(
      buildProviderStatus(def, doc),
      201,
    );
  });
});

// ---------------------------------------------------------------------------
// PUT — update specific fields of an existing provider config
// ---------------------------------------------------------------------------

export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return errorResponse('MongoDB not configured', 503, 'MONGODB_NOT_CONFIGURED');
  }

  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const body: { provider_id: string; fields?: Record<string, string>; enabled?: boolean } =
      await request.json();

    const def = PROVIDER_DEFINITIONS.find(d => d.id === body.provider_id);
    if (!def) throw new ApiError(`Unknown provider: ${body.provider_id}`, 400);

    const col = await getCollection<LLMProviderDoc>(COLLECTION);
    const id = docId(body.provider_id);
    const existing = await col.findOne({ _id: id as any });

    const updatedFields: Record<string, EnvelopeEncrypted | string> = {
      ...(existing?.fields ?? {}),
    };

    // Update only the fields provided; skip empty / MASKED values (user didn't change them).
    // Precedence model: IaC (env vars) trump UI. If a field's env var is set,
    // any submitted value is ignored here so we never accumulate a DB value
    // that will silently not be read at runtime (the Python bootstrap only
    // injects env vars that aren't already set). Accepting the write would
    // create confusing "saved but ineffective" state.
    if (body.fields) {
      for (const field of def.fields) {
        const val = body.fields[field.id];
        if (!val || val === MASKED_SECRET) continue; // not changed
        if (process.env[field.envVar]) continue; // env-locked; IaC wins
        if (field.type === 'password') {
          updatedFields[field.id] = encryptSecret(val);
        } else {
          updatedFields[field.id] = val;
        }
      }
    }

    const doc: LLMProviderDoc = {
      _id: id as any,
      provider_id: body.provider_id,
      enabled: body.enabled ?? existing?.enabled ?? true,
      fields: updatedFields,
      updated_at: new Date(),
    };

    await col.replaceOne({ _id: id as any }, doc, { upsert: true });

    // Notify DA to hot-reload the updated credentials (fire-and-forget).
    void notifyDynamicAgentsRefresh();

    return successResponse(buildProviderStatus(def, doc));
  });
});

// ---------------------------------------------------------------------------
// DELETE — remove a provider DB config (env-sourced entries are unaffected)
// ---------------------------------------------------------------------------

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return errorResponse('MongoDB not configured', 503, 'MONGODB_NOT_CONFIGURED');
  }

  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('provider_id');
    if (!providerId) throw new ApiError('provider_id query param required', 400);

    const col = await getCollection<LLMProviderDoc>(COLLECTION);
    await col.deleteOne({ _id: docId(providerId) as any });

    return successResponse({ deleted: providerId });
  });
});

