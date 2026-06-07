// assisted-by claude code claude-opus-4-8
//
// Standalone OpenFGA adapter for CAS. Intentionally does NOT import from
// lib/rbac/** — the two silos share the same OPENFGA_HTTP env var but own
// separate transport instances. Duplication of the ~25-line transport is
// deliberate; the ESLint boundary rule enforces the separation so each
// surface can migrate independently.

import type {
  Action,
  AuthorizeRequest,
  AuthorizeResult,
  Resource,
  ResourceType,
  Subject,
} from "../contract";
import type { PolicyEngine } from "../engine";
import { BoundedTtlCache } from "../cache";
import { getReasonMeta } from "../reasons";

// ─── Action → OpenFGA check-relation map ─────────────────────────────────────
// Mirrors lib/rbac/tuple-builders.ts ACTION_TO_CHECK_RELATION. Kept in sync
// manually; the lint boundary prevents importing the original across silos.
const ACTION_TO_CHECK_RELATION: Record<Action, string> = {
  discover:        "can_discover",
  read:            "can_read",
  "read-metadata": "can_read_metadata",
  use:             "can_use",
  write:           "can_write",
  create:          "can_manage",
  manage:          "can_manage",
  share:           "can_share",
  delete:          "can_delete",
  ingest:          "can_ingest",
  call:            "can_call",
  invoke:          "can_invoke",
  audit:           "can_audit",
};

// CAS ResourceType → OpenFGA object-type string.
const RESOURCE_TO_OPENFGA_TYPE: Record<ResourceType, string> = {
  agent:          "agent",
  skill:          "skill",
  mcp_tool:       "mcp_tool",
  knowledge_base: "knowledge_base",
  data_source:    "data_source",
  task:           "task",
  slack_channel:  "slack_channel",
  webex_space:    "webex_space",
  organization:   "organization",
  team:           "team",
  conversation:   "conversation",
};

// ─── Transport ────────────────────────────────────────────────────────────────

const DEFAULT_STORE_NAME = "caipe-openfga";
const BATCH_CONCURRENCY = 10;

function baseUrl(): string {
  const url = process.env.OPENFGA_HTTP?.trim()?.replace(/\/+$/, "");
  if (!url) throw new Error("OPENFGA_HTTP is not set");
  return url;
}

function fgaHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

// Module-level store-id cache: warm at first call, invalidated on 404.
let cachedStoreId: string | null = null;

async function resolveStoreId(): Promise<string> {
  const explicit = process.env.OPENFGA_STORE_ID?.trim();
  if (explicit) return explicit;
  if (cachedStoreId) return cachedStoreId;

  const res = await fetch(`${baseUrl()}/stores`, { headers: fgaHeaders() });
  if (!res.ok) throw new Error(`OpenFGA store discovery failed: ${res.status}`);
  const body = (await res.json()) as { stores?: Array<{ id?: string; name?: string }> };
  const storeName = process.env.OPENFGA_STORE_NAME?.trim() || DEFAULT_STORE_NAME;
  const store = body.stores?.find((s) => s.name === storeName);
  if (!store?.id) throw new Error(`OpenFGA store "${storeName}" not found`);
  cachedStoreId = store.id;
  return cachedStoreId;
}

async function fgaCheck(storeId: string, user: string, relation: string, object: string): Promise<boolean> {
  const res = await fetch(`${baseUrl()}/stores/${storeId}/check`, {
    method: "POST",
    headers: fgaHeaders(),
    body: JSON.stringify({ tuple_key: { user, relation, object } }),
  });
  if (res.status === 404) {
    cachedStoreId = null; // invalidate; next call re-resolves
    throw new Error("OpenFGA store not found (404)");
  }
  if (!res.ok) throw new Error(`OpenFGA check failed: ${res.status}`);
  const body = (await res.json()) as { allowed?: boolean };
  return Boolean(body.allowed);
}

// ─── Circuit breaker (per replica) ───────────────────────────────────────────

type CircuitState = "closed" | "open" | "half_open";

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_DURATION_MS = 30_000;

let circuitState: CircuitState = "closed";
let failureCount = 0;
let openSince = 0;
let probeInFlight = false;

/** Synchronous gate. In half_open, admits exactly one probe at a time. */
function circuitAllows(): boolean {
  if (circuitState === "closed") return true;
  if (circuitState === "open") {
    if (Date.now() - openSince < CIRCUIT_OPEN_DURATION_MS) return false; // still cooling down
    circuitState = "half_open"; // cooldown elapsed — fall through to probe handling
  }
  // half_open: admit exactly one probe at a time
  if (probeInFlight) return false;
  probeInFlight = true;
  return true;
}

function recordSuccess(): void {
  failureCount = 0;
  circuitState = "closed";
  probeInFlight = false;
}

function recordFailure(): void {
  probeInFlight = false;
  if (circuitState === "half_open") {
    circuitState = "open";
    openSince = Date.now();
    return;
  }
  failureCount++;
  if (failureCount >= CIRCUIT_FAILURE_THRESHOLD) {
    circuitState = "open";
    openSince = Date.now();
  }
}

/** Test-only reset of breaker + store-id state. */
export function __resetAdapterStateForTests(): void {
  circuitState = "closed";
  failureCount = 0;
  openSince = 0;
  probeInFlight = false;
  cachedStoreId = null;
  cacheHits = 0;
  cacheMisses = 0;
  decisionCache.clear();
}

// ─── Decision cache ───────────────────────────────────────────────────────────

const READ_TTL_MS = Number(process.env.AUTHZ_DECISION_CACHE_TTL_MS ?? 15_000);
const WRITE_TTL_MS = Number(process.env.AUTHZ_DECISION_CACHE_WRITE_TTL_MS ?? 2_000);
const WRITE_ACTIONS = new Set<Action>(["write", "create", "manage", "delete", "ingest"]);

const decisionCache = new BoundedTtlCache<AuthorizeResult>(10_000, READ_TTL_MS);

let cacheHits = 0;
let cacheMisses = 0;

function cacheKey(subject: Subject, resource: Resource, action: Action): string {
  return `${subject.type}:${subject.id}|${resource.type}:${resource.id}|${action}`;
}

/**
 * Live, per-replica adapter snapshot for the CAS health panel. Reflects only
 * the replica that serves the request (circuit + cache are module-local).
 */
export interface EngineStats {
  circuitState: CircuitState;
  cacheSize: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatio: number;
}

export function getEngineStats(): EngineStats {
  const total = cacheHits + cacheMisses;
  return {
    circuitState,
    cacheSize: decisionCache.size,
    cacheHits,
    cacheMisses,
    cacheHitRatio: total > 0 ? cacheHits / total : 0,
  };
}

function ttlForAction(action: Action): number {
  return WRITE_ACTIONS.has(action) ? WRITE_TTL_MS : READ_TTL_MS;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function boundedParallel<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const item = items[index++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

function allow(): AuthorizeResult {
  return { decision: "ALLOW", reason: "OK", retriable: getReasonMeta("OK").retriable, ttl_seconds: Math.floor(READ_TTL_MS / 1000) };
}

function deny(reason: AuthorizeResult["reason"] = "NO_CAPABILITY"): AuthorizeResult {
  return { decision: "DENY", reason, retriable: getReasonMeta(reason).retriable };
}

async function runCheck(req: AuthorizeRequest): Promise<AuthorizeResult> {
  if (!circuitAllows()) return deny("AUTHZ_UNAVAILABLE");

  const relation = ACTION_TO_CHECK_RELATION[req.action];
  const objectType = RESOURCE_TO_OPENFGA_TYPE[req.resource.type];
  const user = `${req.subject.type}:${req.subject.id}`;
  const object = `${objectType}:${req.resource.id}`;

  try {
    const storeId = await resolveStoreId();
    const allowed = await fgaCheck(storeId, user, relation, object);
    recordSuccess();
    return allowed ? allow() : deny("NO_CAPABILITY");
  } catch (err) {
    recordFailure();
    console.warn("[cas/openfga] check error:", err instanceof Error ? err.message : String(err));
    return deny("AUTHZ_UNAVAILABLE");
  }
}

async function checkWithCache(req: AuthorizeRequest): Promise<AuthorizeResult> {
  const key = cacheKey(req.subject, req.resource, req.action);
  const cached = decisionCache.get(key);
  if (cached) {
    cacheHits++;
    return cached;
  }
  cacheMisses++;

  const result = await runCheck(req);
  // Only cache definitive outcomes — never cache transient unavailability.
  if (result.reason !== "AUTHZ_UNAVAILABLE") {
    decisionCache.set(key, result, ttlForAction(req.action));
  }
  return result;
}

// ─── PolicyEngine ─────────────────────────────────────────────────────────────

export function createOpenFgaEngine(): PolicyEngine {
  return {
    check(req: AuthorizeRequest): Promise<AuthorizeResult> {
      return checkWithCache(req);
    },

    async batchCheck(
      subject: Subject,
      action: Action,
      resourceType: ResourceType,
      ids: string[],
    ): Promise<Map<string, AuthorizeResult>> {
      const results = new Map<string, AuthorizeResult>();
      await boundedParallel(ids, BATCH_CONCURRENCY, async (id) => {
        const result = await checkWithCache({ subject, action, resource: { type: resourceType, id } });
        results.set(id, result);
      });
      return results;
    },
  };
}

/**
 * Debug describe for the admin /explain endpoint — the ONLY place OpenFGA
 * vocabulary (relation strings, store id, tuple shape) is exposed. Reuses
 * the same maps as the live check so explain can never drift from reality.
 */
export function describeFgaCheck(req: AuthorizeRequest): {
  engine: "openfga";
  relation: string;
  user: string;
  object: string;
  store: string;
} {
  return {
    engine: "openfga",
    relation: ACTION_TO_CHECK_RELATION[req.action],
    user: `${req.subject.type}:${req.subject.id}`,
    object: `${RESOURCE_TO_OPENFGA_TYPE[req.resource.type]}:${req.resource.id}`,
    store: process.env.OPENFGA_STORE_ID?.trim() || cachedStoreId || "(resolved at boot)",
  };
}
