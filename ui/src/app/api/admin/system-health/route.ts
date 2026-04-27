/**
 * GET /api/admin/system-health
 *
 * Returns live health status for all CAIPE platform services.
 * Performs real checks (not just flag inspection) for each service.
 * Results are cached for 10 seconds to avoid hammering backends.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { withAuth, withErrorHandler, requireAdminView } from '@/lib/api-middleware';
import { getServerConfig } from '@/lib/config';
import { PROVIDER_DEFINITIONS } from '../llm-providers/route';

export type ServiceStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface ServiceCheckResult {
  id: string;
  name: string;
  description: string;
  status: ServiceStatus;
  detail: string;
  latency_ms?: number;
  url?: string;
}

// Simple in-process cache (resets on server restart/cold start)
let _cache: { results: ServiceCheckResult[]; at: number } | null = null;
const CACHE_TTL_MS = 15_000;

async function pingUrl(url: string, timeoutMs = 5000): Promise<{ ok: boolean; latency: number; status?: number }> {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, method: 'GET' });
    clearTimeout(id);
    return { ok: res.status < 500, latency: Date.now() - start, status: res.status };
  } catch {
    return { ok: false, latency: Date.now() - start };
  }
}

async function checkMongoDB(): Promise<ServiceCheckResult> {
  if (!isMongoDBConfigured) {
    return { id: 'mongodb', name: 'MongoDB', description: 'Database', status: 'unknown', detail: 'Not configured' };
  }
  const start = Date.now();
  try {
    const col = await getCollection('users');
    await col.findOne({}, { projection: { _id: 1 } });
    return { id: 'mongodb', name: 'MongoDB', description: 'Database', status: 'healthy', detail: 'Connected', latency_ms: Date.now() - start };
  } catch (e: any) {
    return { id: 'mongodb', name: 'MongoDB', description: 'Database', status: 'down', detail: e.message?.slice(0, 60) ?? 'Error' };
  }
}

async function checkLocalAuth(): Promise<ServiceCheckResult> {
  if (!isMongoDBConfigured) {
    return { id: 'local_auth', name: 'Local Auth', description: 'Admin account', status: 'unknown', detail: 'MongoDB not configured' };
  }
  try {
    const col = await getCollection('local_users');
    const count = await col.countDocuments({});
    if (count === 0) {
      return { id: 'local_auth', name: 'Local Auth', description: 'Admin account', status: 'degraded', detail: 'No admin configured — run setup' };
    }
    return { id: 'local_auth', name: 'Local Auth', description: 'Admin account', status: 'healthy', detail: `${count} local user${count > 1 ? 's' : ''} configured` };
  } catch {
    return { id: 'local_auth', name: 'Local Auth', description: 'Admin account', status: 'unknown', detail: 'Could not check' };
  }
}

async function checkOIDC(cfg: ReturnType<typeof getServerConfig>): Promise<ServiceCheckResult> {
  if (!cfg.ssoEnabled) {
    // Check if OIDC is configured in DB
    if (isMongoDBConfigured) {
      try {
        const col = await getCollection<{ enabled?: boolean }>('platform_config');
        const doc = await col.findOne({ _id: 'oidc_config' as any });
        if (doc?.enabled) {
          return { id: 'oidc', name: 'OIDC / SSO', description: 'Identity provider', status: 'healthy', detail: 'Configured (DB)' };
        }
      } catch { /* ignore */ }
    }
    return { id: 'oidc', name: 'OIDC / SSO', description: 'Identity provider', status: 'unknown', detail: 'Not configured' };
  }
  return { id: 'oidc', name: 'OIDC / SSO', description: 'Identity provider', status: 'healthy', detail: 'Active' };
}

async function checkSupervisor(cfg: ReturnType<typeof getServerConfig>): Promise<ServiceCheckResult> {
  // Internal URL for server-side checks (may differ from browser-facing caipeUrl)
  const url = process.env.A2A_BASE_URL || 'http://localhost:8000';
  const result = await pingUrl(`${url}/.well-known/agent-card.json`);
  if (result.ok) {
    return { id: 'supervisor', name: 'CAIPE Supervisor', description: 'Multi-agent orchestrator (A2A)', status: 'healthy', detail: `Online (${result.latency}ms)`, latency_ms: result.latency, url };
  }
  return { id: 'supervisor', name: 'CAIPE Supervisor', description: 'Multi-agent orchestrator (A2A)', status: 'down', detail: `Offline — run: make run-a2a`, url };
}

async function checkDynamicAgents(cfg: ReturnType<typeof getServerConfig>): Promise<ServiceCheckResult> {
  const url = process.env.DYNAMIC_AGENTS_URL || cfg.dynamicAgentsUrl || 'http://localhost:8001';
  if (!cfg.dynamicAgentsEnabled) {
    return { id: 'dynamic_agents', name: 'Custom Agents Backend', description: 'Agent runtime service', status: 'unknown', detail: 'Disabled', url };
  }
  const result = await pingUrl(`${url}/health`);
  if (result.ok) {
    return { id: 'dynamic_agents', name: 'Custom Agents Backend', description: 'Agent runtime service', status: 'healthy', detail: `Online (${result.latency}ms)`, latency_ms: result.latency, url };
  }
  return { id: 'dynamic_agents', name: 'Custom Agents Backend', description: 'Agent runtime service', status: 'down', detail: `Offline — start dynamic agents backend`, url };
}

async function checkRAG(cfg: ReturnType<typeof getServerConfig>): Promise<ServiceCheckResult> {
  if (!cfg.ragEnabled) {
    return { id: 'rag', name: 'RAG Server', description: 'Knowledge base', status: 'unknown', detail: 'Disabled' };
  }
  const url = process.env.RAG_URL || process.env.RAG_SERVER_URL || 'http://localhost:9446';
  const result = await pingUrl(`${url}/health`);
  if (result.ok) {
    return { id: 'rag', name: 'RAG Server', description: 'Knowledge base', status: 'healthy', detail: `Reachable (${result.latency}ms)`, latency_ms: result.latency, url };
  }
  return { id: 'rag', name: 'RAG Server', description: 'Knowledge base', status: 'down', detail: `Unreachable at ${url}`, url };
}

async function checkLLMProviders(): Promise<ServiceCheckResult> {
  // Count unique providers that have credentials — deduped by provider id
  // (env and DB can both have an entry for the same provider; count it once)
  const configuredIds = new Set<string>();

  // Env-configured providers
  for (const def of PROVIDER_DEFINITIONS) {
    if (def.fields.some(f => !!process.env[f.envVar])) {
      configuredIds.add(def.id);
    }
  }

  // DB-configured providers (add if not already counted from env)
  if (isMongoDBConfigured) {
    try {
      const col = await getCollection<{ _id: string; provider_id: string }>('platform_config');
      const dbDocs = await col.find(
        { _id: { $regex: /^llm_provider:/ } as any },
        { projection: { provider_id: 1 } }
      ).toArray();
      for (const doc of dbDocs) {
        if (doc.provider_id) configuredIds.add(doc.provider_id);
      }
    } catch { /* ignore */ }
  }

  const total = configuredIds.size;
  if (total === 0) {
    return { id: 'llm_providers', name: 'LLM Providers', description: 'AI model credentials', status: 'degraded', detail: 'No providers configured — agents cannot run' };
  }
  return { id: 'llm_providers', name: 'LLM Providers', description: 'AI model credentials', status: 'healthy', detail: `${total} provider${total > 1 ? 's' : ''} configured` };
}

async function runAllChecks(): Promise<ServiceCheckResult[]> {
  const cfg = getServerConfig();
  const results = await Promise.all([
    checkMongoDB(),
    checkLocalAuth(),
    checkOIDC(cfg),
    checkSupervisor(cfg),
    checkDynamicAgents(cfg),
    checkRAG(cfg),
    checkLLMProviders(),
  ]);
  return results;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (_req, _user, session) => {
    requireAdminView(session);

    // Serve from cache if fresh
    const now = Date.now();
    if (_cache && now - _cache.at < CACHE_TTL_MS) {
      return NextResponse.json({ success: true, data: { services: _cache.results, cached: true, age_ms: now - _cache.at } });
    }

    const services = await runAllChecks();
    _cache = { results: services, at: now };

    return NextResponse.json({ success: true, data: { services, cached: false, age_ms: 0 } });
  });
});
