import { createHash } from "crypto";
import { NextRequest } from "next/server";
import {
  getAuthFromBearerOrSession,
  withErrorHandler,
  successResponse,
  requireRbacPermission,
  ApiError,
} from "@/lib/api-middleware";

interface SlackUserProfile {
  display_name?: string;
  display_name_normalized?: string;
  real_name?: string;
  real_name_normalized?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  image_24?: string;
  image_32?: string;
}

interface SlackUser {
  id: string;
  team_id?: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  real_name?: string;
  profile?: SlackUserProfile;
}

interface SlackUsersListResponse {
  ok: boolean;
  error?: string;
  members?: SlackUser[];
  response_metadata?: { next_cursor?: string };
}

interface SlackLookupByEmailResponse {
  ok: boolean;
  error?: string;
  user?: SlackUser;
}

interface SlackUserResult {
  id: string;
  label: string;
  name?: string;
  display_name?: string;
  real_name?: string;
  avatar?: string;
  is_bot: boolean;
  is_workflow?: boolean;
  search_terms?: string[];
}

interface CacheEntry {
  users: SlackUserResult[];
  fetched_at: number;
  refreshing?: Promise<SlackUserResult[]>;
  last_error?: string;
  pages_scanned?: number;
  members_seen?: number;
  active_seen?: number;
  started_at?: number;
  updated_at?: number;
  rate_limited_until?: number;
}

const SLACK_PAGE_SIZE = 200;
// Enterprise Grid directories can be much larger than 10k users. This walk
// runs only as a background cache refresh, so use a high safety cap instead of
// stopping before Slack's cursor is exhausted.
const MAX_SLACK_PAGES = 500;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_RATE_LIMIT_WAIT_MS = 15_000;
const USER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RATE_LIMIT_RETRIES = 3;

const cache = new Map<string, CacheEntry>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function tokenCacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export function __resetSlackUsersLookupCacheForTests(): void {
  cache.clear();
}

function normalizeSlackUser(user: SlackUser): SlackUserResult | null {
  if (!user.id || user.deleted) return null;
  const profile = user.profile ?? {};
  const displayName = profile.display_name_normalized || profile.display_name;
  const realName = profile.real_name_normalized || profile.real_name || user.real_name;
  const name = user.name;
  const label = displayName || realName || name || user.id;
  const isWorkflow = [name, label, displayName, realName, profile.title]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes("workflow"));
  const firstLast = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  const searchTerms = Array.from(new Set([
    user.id,
    user.team_id ?? "",
    name ?? "",
    label,
    displayName ?? "",
    realName ?? "",
    firstLast,
    profile.first_name ?? "",
    profile.last_name ?? "",
    profile.title ?? "",
    profile.email ?? "",
  ].map((term) => term.trim()).filter(Boolean)));
  return {
    id: user.id,
    label,
    ...(name ? { name } : {}),
    ...(displayName ? { display_name: displayName } : {}),
    ...(realName ? { real_name: realName } : {}),
    ...(profile.image_32 || profile.image_24 ? { avatar: profile.image_32 || profile.image_24 } : {}),
    is_bot: Boolean(user.is_bot || user.is_app_user),
    ...(isWorkflow ? { is_workflow: true } : {}),
    search_terms: searchTerms,
  };
}

async function callSlackJson<T>(token: string, endpoint: string, params: Record<string, string>, attempt = 0): Promise<T> {
  const url = new URL(`https://slack.com/api/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMessage = cause instanceof Error ? `${cause.name}: ${cause.message}` : err instanceof Error ? err.message : String(err);
    throw new ApiError(`Slack user lookup network failure (${endpoint}): ${causeMessage}`, 502);
  }

  if (res.status === 429) {
    if (attempt >= MAX_RATE_LIMIT_RETRIES) {
      throw new ApiError(`Slack API rate limited ${endpoint} after ${MAX_RATE_LIMIT_RETRIES} retries`, 429);
    }
    const retryAfter = Number(res.headers.get("retry-after") ?? "1");
    const backoffMs = 2 ** attempt * 1000;
    const waitMs = Math.min(Math.max(retryAfter, 1) * 1000 + backoffMs, MAX_RATE_LIMIT_WAIT_MS);
    await sleep(waitMs);
    return callSlackJson<T>(token, endpoint, params, attempt + 1);
  }

  let data: T;
  try {
    data = (await res.json()) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(`Slack user lookup returned a non-JSON response from ${endpoint} (status ${res.status}): ${message}`, 502);
  }
  return data;
}

async function lookupByEmail(token: string, email: string): Promise<SlackUserResult[]> {
  const data = await callSlackJson<SlackLookupByEmailResponse>(token, "users.lookupByEmail", { email });
  if (!data.ok) {
    if (data.error === "users_not_found") return [];
    throw new ApiError(`Slack API error: ${data.error ?? "unknown"}`, 502);
  }
  const normalized = data.user ? normalizeSlackUser(data.user) : null;
  return normalized ? [normalized] : [];
}

async function walkSlackUsers(token: string): Promise<SlackUserResult[]> {
  const out: SlackUserResult[] = [];
  let cursor = "";
  const cacheKey = tokenCacheKey(token);
  const startedAt = Date.now();

  for (let page = 0; page < MAX_SLACK_PAGES; page++) {
    const data = await callSlackJson<SlackUsersListResponse>(token, "users.list", {
      limit: String(SLACK_PAGE_SIZE),
      cursor,
    });
    if (!data.ok) {
      throw new ApiError(`Slack API error: ${data.error ?? "unknown"}`, 502);
    }
    for (const member of data.members ?? []) {
      const normalized = normalizeSlackUser(member);
      if (normalized) out.push(normalized);
    }
    cache.set(cacheKey, {
      users: out,
      fetched_at: 0,
      refreshing: cache.get(cacheKey)?.refreshing,
      last_error: cache.get(cacheKey)?.last_error,
      pages_scanned: page + 1,
      members_seen: (cache.get(cacheKey)?.members_seen ?? 0) + (data.members?.length ?? 0),
      active_seen: out.length,
      started_at: startedAt,
      updated_at: Date.now(),
    });
    cursor = data.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }

  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

function refreshSlackUsersCache(token: string, cacheKey: string): Promise<SlackUserResult[]> {
  const existing = cache.get(cacheKey);
  if (existing?.refreshing) return existing.refreshing;

  const refreshing = walkSlackUsers(token)
    .then((users) => {
      const existingAfterWalk = cache.get(cacheKey);
      cache.set(cacheKey, {
        users,
        fetched_at: Date.now(),
        pages_scanned: existingAfterWalk?.pages_scanned,
        members_seen: existingAfterWalk?.members_seen,
        active_seen: users.length,
        started_at: existingAfterWalk?.started_at,
        updated_at: Date.now(),
      });
      return users;
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      cache.set(cacheKey, {
        users: existing?.users ?? [],
        fetched_at: existing?.fetched_at ?? 0,
        last_error: message,
        pages_scanned: existing?.pages_scanned,
        members_seen: existing?.members_seen,
        active_seen: existing?.active_seen,
        started_at: existing?.started_at,
        updated_at: Date.now(),
      });
      throw err;
    });

  cache.set(cacheKey, {
    users: existing?.users ?? [],
    fetched_at: existing?.fetched_at ?? 0,
    refreshing,
    last_error: existing?.last_error,
    pages_scanned: existing?.pages_scanned ?? 0,
    members_seen: existing?.members_seen ?? 0,
    active_seen: existing?.active_seen ?? existing?.users.length ?? 0,
    started_at: Date.now(),
    updated_at: Date.now(),
  });
  return refreshing;
}

export function warmSlackUsersDirectory(token: string): void {
  const cacheKey = tokenCacheKey(token);
  const cached = cache.get(cacheKey);
  const fresh = cached?.users.length && Date.now() - cached.fetched_at < USER_CACHE_TTL_MS;
  if (!fresh) {
    void refreshSlackUsersCache(token, cacheKey).catch((err) => {
      console.warn("[Admin SlackUsers] background refresh failed", err);
    });
  }
}

export function getSlackUsersDirectoryStatus(token: string) {
  const cached = cache.get(tokenCacheKey(token));
  const now = Date.now();
  const hasSnapshot = Boolean(cached?.users.length);
  const fresh = Boolean(hasSnapshot && cached && now - cached.fetched_at < USER_CACHE_TTL_MS);
  return {
    status: cached?.refreshing ? "warming" : fresh ? "ready" : hasSnapshot ? "stale" : "empty",
    users_indexed: cached?.users.length ?? 0,
    active_users_indexed: cached?.active_seen ?? cached?.users.length ?? 0,
    pages_scanned: cached?.pages_scanned ?? 0,
    members_seen: cached?.members_seen ?? 0,
    fetched_at: cached?.fetched_at || null,
    updated_at: cached?.updated_at || null,
    started_at: cached?.started_at || null,
    ttl_seconds: Math.floor(USER_CACHE_TTL_MS / 1000),
    last_error: cached?.last_error,
  };
}

function fuzzyScore(value: string, query: string): number {
  const normalized = value.toLowerCase();
  if (!normalized || !query) return Number.POSITIVE_INFINITY;
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 10 + normalized.length - query.length;
  const wordStartIndex = normalized.search(new RegExp(`(^|[\\s._-])${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  if (wordStartIndex >= 0) return 20 + wordStartIndex;
  const includesIndex = normalized.indexOf(query);
  if (includesIndex >= 0) return 40 + includesIndex;

  let lastIndex = -1;
  let gapPenalty = 0;
  for (const char of query) {
    const nextIndex = normalized.indexOf(char, lastIndex + 1);
    if (nextIndex < 0) return Number.POSITIVE_INFINITY;
    gapPenalty += nextIndex - lastIndex - 1;
    lastIndex = nextIndex;
  }
  return 80 + gapPenalty + normalized.length - query.length;
}

function userSearchScore(user: SlackUserResult, query: string): number {
  const terms = user.search_terms && user.search_terms.length > 0
    ? user.search_terms
    : [user.label, user.id, user.name ?? "", user.display_name ?? "", user.real_name ?? ""];
  const directScore = Math.min(
    ...terms.map((term) => fuzzyScore(term, query)),
    fuzzyScore(terms.join(" "), query),
  );
  if (Number.isFinite(directScore)) return directScore;

  const queryParts = query.split(/\s+/).filter(Boolean);
  if (queryParts.length <= 1) return Number.POSITIVE_INFINITY;

  const partScores = queryParts.map((part) => Math.min(...terms.map((term) => fuzzyScore(term, part))));
  if (partScores.every(Number.isFinite)) {
    return 60 + partScores.reduce((sum, score) => sum + score, 0);
  }
  return Number.POSITIVE_INFINITY;
}

function toPublicUser(user: SlackUserResult): Omit<SlackUserResult, "search_terms"> {
  // Strip search-only fields before returning data to the browser.
  const { search_terms, ...publicUser } = user;
  void search_terms;
  return publicUser;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) {
    throw new ApiError("SLACK_BOT_TOKEN is not configured on the UI service. Slack user lookup is unavailable.", 503);
  }

  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim();
  const kind = params.get("kind") === "bots" ? "bots" : "all";
  const refresh = params.get("refresh") === "1";
  const requestedLimit = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;

  if (!q) {
    return successResponse({ users: [], cached: false, fetched_at: Date.now(), query: { q, limit, kind } });
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) {
    const users = await lookupByEmail(token, q);
    const filtered = kind === "bots" ? users.filter((user) => user.is_bot || user.is_workflow) : users;
    return successResponse({ users: filtered.slice(0, limit).map(toPublicUser), cached: false, fetched_at: Date.now(), query: { q, limit, kind, mode: "email" } });
  }

  const now = Date.now();
  const cacheKey = tokenCacheKey(token);
  const cached = cache.get(cacheKey);
  const hasSnapshot = Boolean(cached && cached.users.length > 0);
  const cacheFresh = hasSnapshot && now - (cached?.fetched_at ?? 0) < USER_CACHE_TTL_MS;

  if (refresh || !cacheFresh) {
    void refreshSlackUsersCache(token, cacheKey).catch((err) => {
      console.warn("[Admin SlackUsers] background refresh failed", err);
    });
  }

  if (!hasSnapshot) {
    return successResponse({
      users: [],
      total_matches: 0,
      total_visible: 0,
      cached: false,
      warming: true,
      fetched_at: cached?.fetched_at ?? 0,
      error: cached?.last_error,
      query: { q, limit, kind, mode: "list" },
    });
  }

  const query = q.toLowerCase();
  const searchableUsers = kind === "bots"
    ? cached!.users.filter((user) => user.is_bot || user.is_workflow)
    : cached!.users;
  const scored = searchableUsers
    .map((user) => ({ user, score: userSearchScore(user, query) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.user.label.localeCompare(b.user.label));
  return successResponse({
    users: scored.slice(0, limit).map((entry) => toPublicUser(entry.user)),
    total_matches: scored.length,
    total_visible: searchableUsers.length,
    cached: true,
    refreshing: !cacheFresh,
    fetched_at: cached!.fetched_at,
    query: { q, limit, kind, mode: "list" },
  });
});
