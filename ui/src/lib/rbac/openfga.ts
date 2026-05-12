export interface OpenFgaTupleKey {
  user: string;
  relation: string;
  object: string;
}

export interface ResourceStringDiff {
  added: string[];
  removed: string[];
}

export interface ResourceBooleanDiff {
  added: boolean;
  removed: boolean;
}

export interface TeamResourceTupleDiffInput {
  teamSlug: string;
  memberUserIds: string[];
  agents: ResourceStringDiff;
  agentAdmins: ResourceStringDiff;
  tools: ResourceStringDiff;
  toolWildcard: ResourceBooleanDiff;
}

export interface TeamResourceTupleDiff {
  writes: OpenFgaTupleKey[];
  deletes: OpenFgaTupleKey[];
}

export interface OpenFgaReconcileResult {
  enabled: boolean;
  writes: number;
  deletes: number;
}

export interface OpenFgaTuple {
  key: OpenFgaTupleKey;
  timestamp?: string;
}

export interface OpenFgaReadOptions {
  tuple?: Partial<OpenFgaTupleKey>;
  pageSize?: number;
  continuationToken?: string;
}

export interface OpenFgaReadResult {
  tuples: OpenFgaTuple[];
  continuationToken?: string;
}

export interface OpenFgaCheckResult {
  allowed: boolean;
}

const DEFAULT_STORE_NAME = "caipe-openfga";
const MAX_READ_PAGE_SIZE = 200;

function openFgaHttpUrl(): string | null {
  const url = process.env.OPENFGA_HTTP?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

function openFgaStoreName(): string {
  return process.env.OPENFGA_STORE_NAME?.trim() || DEFAULT_STORE_NAME;
}

export function isOpenFgaConfigured(): boolean {
  return Boolean(openFgaHttpUrl());
}

export function isOpenFgaReconciliationEnabled(): boolean {
  return process.env.OPENFGA_RECONCILE_ENABLED?.trim().toLowerCase() === "true" && Boolean(openFgaHttpUrl());
}

function uniqueTuples(tuples: OpenFgaTupleKey[]): OpenFgaTupleKey[] {
  const seen = new Set<string>();
  const out: OpenFgaTupleKey[] = [];
  for (const tuple of tuples) {
    const key = `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tuple);
  }
  return out;
}

function resourceTuples(
  teamSlug: string,
  relation: string,
  objectType: "agent" | "tool",
  ids: string[]
): OpenFgaTupleKey[] {
  return ids.map((id) => ({
    user: `team:${teamSlug}#member`,
    relation,
    object: `${objectType}:${id}`,
  }));
}

export function buildTeamResourceTupleDiff(input: TeamResourceTupleDiffInput): TeamResourceTupleDiff {
  const teamObject = `team:${input.teamSlug}`;
  const memberTuples = input.memberUserIds.map((userId) => ({
    user: `user:${userId}`,
    relation: "member",
    object: teamObject,
  }));

  const writes = uniqueTuples([
    ...memberTuples,
    ...resourceTuples(input.teamSlug, "can_use", "agent", input.agents.added),
    ...resourceTuples(input.teamSlug, "can_manage", "agent", input.agentAdmins.added),
    ...resourceTuples(input.teamSlug, "can_call", "tool", input.tools.added),
    ...(input.toolWildcard.added
      ? resourceTuples(input.teamSlug, "can_call", "tool", ["*"])
      : []),
  ]);

  const deletes = uniqueTuples([
    ...resourceTuples(input.teamSlug, "can_use", "agent", input.agents.removed),
    ...resourceTuples(input.teamSlug, "can_manage", "agent", input.agentAdmins.removed),
    ...resourceTuples(input.teamSlug, "can_call", "tool", input.tools.removed),
    ...(input.toolWildcard.removed
      ? resourceTuples(input.teamSlug, "can_call", "tool", ["*"])
      : []),
  ]);

  return { writes, deletes };
}

export async function getOpenFgaStoreId(): Promise<string> {
  const explicitStoreId = process.env.OPENFGA_STORE_ID?.trim();
  if (explicitStoreId) return explicitStoreId;

  const baseUrl = openFgaHttpUrl();
  if (!baseUrl) {
    throw new Error("OPENFGA_HTTP is not set");
  }

  const response = await fetch(`${baseUrl}/stores`, { method: "GET" });
  if (!response.ok) {
    throw new Error(`OpenFGA store discovery failed: ${response.status}`);
  }
  const body = (await response.json()) as { stores?: Array<{ id?: string; name?: string }> };
  const store = body.stores?.find((candidate) => candidate.name === openFgaStoreName());
  if (!store?.id) {
    throw new Error(`OpenFGA store ${openFgaStoreName()} was not found`);
  }
  return store.id;
}

async function tupleAllowed(baseUrl: string, storeId: string, tuple: OpenFgaTupleKey): Promise<boolean> {
  const response = await fetch(`${baseUrl}/stores/${storeId}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tuple_key: tuple }),
  });
  if (!response.ok) {
    throw new Error(`OpenFGA tuple check failed: ${response.status}`);
  }
  const body = (await response.json()) as { allowed?: boolean };
  return Boolean(body.allowed);
}

function tupleKeyFilter(tuple?: Partial<OpenFgaTupleKey>): Partial<OpenFgaTupleKey> | undefined {
  if (!tuple) return undefined;
  const out: Partial<OpenFgaTupleKey> = {};
  if (tuple.user?.trim()) out.user = tuple.user.trim();
  if (tuple.relation?.trim()) out.relation = tuple.relation.trim();
  if (tuple.object?.trim()) out.object = tuple.object.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function checkOpenFgaTuple(tuple: OpenFgaTupleKey): Promise<OpenFgaCheckResult> {
  const baseUrl = openFgaHttpUrl();
  if (!baseUrl) {
    throw new Error("OPENFGA_HTTP is not set");
  }
  const storeId = await getOpenFgaStoreId();
  return { allowed: await tupleAllowed(baseUrl, storeId, tuple) };
}

export async function readOpenFgaTuples(options: OpenFgaReadOptions = {}): Promise<OpenFgaReadResult> {
  const baseUrl = openFgaHttpUrl();
  if (!baseUrl) {
    throw new Error("OPENFGA_HTTP is not set");
  }
  const storeId = await getOpenFgaStoreId();
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), MAX_READ_PAGE_SIZE);
  const body = {
    ...(tupleKeyFilter(options.tuple) ? { tuple_key: tupleKeyFilter(options.tuple) } : {}),
    page_size: pageSize,
    ...(options.continuationToken ? { continuation_token: options.continuationToken } : {}),
  };

  const response = await fetch(`${baseUrl}/stores/${storeId}/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenFGA tuple read failed: ${response.status} ${errorBody.slice(0, 200)}`);
  }
  const payload = (await response.json()) as {
    tuples?: Array<{ key?: OpenFgaTupleKey; timestamp?: string }>;
    continuation_token?: string;
  };
  return {
    tuples: (payload.tuples ?? [])
      .filter((tuple): tuple is { key: OpenFgaTupleKey; timestamp?: string } => Boolean(tuple.key))
      .map((tuple) => ({ key: tuple.key, timestamp: tuple.timestamp })),
    continuationToken: payload.continuation_token || undefined,
  };
}

export async function writeOpenFgaTuples(diff: TeamResourceTupleDiff): Promise<OpenFgaReconcileResult> {
  if (!isOpenFgaConfigured()) {
    return { enabled: false, writes: 0, deletes: 0 };
  }
  if (diff.writes.length === 0 && diff.deletes.length === 0) {
    return { enabled: true, writes: 0, deletes: 0 };
  }

  const baseUrl = openFgaHttpUrl();
  if (!baseUrl) {
    throw new Error("OPENFGA_HTTP is not set");
  }
  const storeId = await getOpenFgaStoreId();
  const filteredDiff = await filterTupleDiff(baseUrl, storeId, diff);
  if (filteredDiff.writes.length === 0 && filteredDiff.deletes.length === 0) {
    return { enabled: true, writes: 0, deletes: 0 };
  }
  const body = {
    ...(filteredDiff.writes.length > 0 ? { writes: { tuple_keys: filteredDiff.writes } } : {}),
    ...(filteredDiff.deletes.length > 0 ? { deletes: { tuple_keys: filteredDiff.deletes } } : {}),
  };

  const response = await fetch(`${baseUrl}/stores/${storeId}/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenFGA tuple write failed: ${response.status} ${errorBody.slice(0, 200)}`);
  }

  return { enabled: true, writes: filteredDiff.writes.length, deletes: filteredDiff.deletes.length };
}

async function filterTupleDiff(
  baseUrl: string,
  storeId: string,
  diff: TeamResourceTupleDiff
): Promise<TeamResourceTupleDiff> {
  const writes = (
    await Promise.all(
      diff.writes.map(async (tuple) => ((await tupleAllowed(baseUrl, storeId, tuple)) ? null : tuple))
    )
  ).filter((tuple): tuple is OpenFgaTupleKey => tuple !== null);
  const deletes = (
    await Promise.all(
      diff.deletes.map(async (tuple) => ((await tupleAllowed(baseUrl, storeId, tuple)) ? tuple : null))
    )
  ).filter((tuple): tuple is OpenFgaTupleKey => tuple !== null);
  return { writes, deletes };
}

export async function writeOpenFgaTupleDiff(diff: TeamResourceTupleDiff): Promise<OpenFgaReconcileResult> {
  if (!isOpenFgaReconciliationEnabled()) {
    return { enabled: false, writes: 0, deletes: 0 };
  }
  return writeOpenFgaTuples(diff);
}
