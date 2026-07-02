/**
 * Webex space discovery for the team-assignment UI.
 *
 * GET /api/admin/webex/available-spaces
 *   Returns Webex rooms/spaces the bot can see when WEBEX_INTEGRATION_BOT_ACCESS_TOKEN is configured.
 *
 * When WEBEX_INTEGRATION_BOT_ACCESS_TOKEN is unset, returns 503 so admins can paste space IDs manually.
 */

import {
ApiError,
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getDiscoveryCacheTtlMs } from "@/lib/rbac/discovery-cache-config";
import { NextRequest } from "next/server";

interface WebexRoom {
  id: string;
  title?: string;
  type?: string;
  isLocked?: boolean;
  lastActivity?: string;
}

interface WebexListResponse {
  items?: WebexRoom[];
  link?: { rel?: string; href?: string }[];
}

interface NormalizedSpace {
  id: string;
  webex_room_id?: string;
  name: string;
  type: string;
  is_locked: boolean;
}

interface CacheEntry {
  spaces: NormalizedSpace[];
  fetched_at: number;
  refreshing?: Promise<NormalizedSpace[]>;
  last_error?: string;
  started_at?: number;
  updated_at?: number;
}

// Webex space lists rarely change between admin actions. The TTL is
// admin-configurable in Admin → Platform Settings → Discovery cache TTL
// and is read live from `platform_config` via getDiscoveryCacheTtlMs();
// the default is 60 minutes, and 0 disables caching.
const DEFAULT_UI_LIMIT = 200;
const MAX_UI_LIMIT = 500;
const MAX_WEBEX_PAGES = 50;

const cache = new Map<string, CacheEntry>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tokenCacheKey(token: string): string {
  return token.slice(-12);
}

export function __resetWebexSpaceDiscoveryCacheForTests(): void {
  cache.clear();
}

function refreshWebexSpaceCache(token: string): Promise<NormalizedSpace[]> {
  const cacheKey = tokenCacheKey(token);
  const existing = cache.get(cacheKey);
  if (existing?.refreshing) return existing.refreshing;

  const refreshing = listAllRooms(token)
    .then((spaces) => {
      cache.set(cacheKey, {
        spaces,
        fetched_at: Date.now(),
        started_at: existing?.started_at,
        updated_at: Date.now(),
      });
      return spaces;
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      cache.set(cacheKey, {
        spaces: existing?.spaces ?? [],
        fetched_at: existing?.fetched_at ?? 0,
        last_error: message,
        started_at: existing?.started_at,
        updated_at: Date.now(),
      });
      throw err;
    });

  cache.set(cacheKey, {
    spaces: existing?.spaces ?? [],
    fetched_at: existing?.fetched_at ?? 0,
    refreshing,
    last_error: existing?.last_error,
    started_at: Date.now(),
    updated_at: Date.now(),
  });
  return refreshing;
}

export function warmWebexSpaceDiscovery(token: string): void {
  void getDiscoveryCacheTtlMs()
    .then((cacheTtlMs) => {
      const cacheKey = tokenCacheKey(token);
      const cached = cache.get(cacheKey);
      const fresh =
        cacheTtlMs > 0 &&
        Boolean(cached?.spaces.length) &&
        Date.now() - (cached?.fetched_at ?? 0) < cacheTtlMs;
      if (!fresh) {
        void refreshWebexSpaceCache(token).catch((err) => {
          console.warn("[Admin WebexSpaces] background refresh failed", err);
        });
      }
    })
    .catch((err) => {
      console.warn("[Admin WebexSpaces] failed to read discovery cache TTL", err);
    });
}

export async function getWebexSpaceDiscoveryStatus(token: string) {
  const cacheTtlMs = await getDiscoveryCacheTtlMs();
  const cached = cache.get(tokenCacheKey(token));
  const now = Date.now();
  const hasSnapshot = Boolean(cached?.spaces.length);
  const fresh = Boolean(hasSnapshot && cacheTtlMs > 0 && cached && now - cached.fetched_at < cacheTtlMs);
  return {
    status: cached?.refreshing ? ("warming" as const) : fresh ? ("ready" as const) : hasSnapshot ? ("stale" as const) : ("empty" as const),
    spaces_indexed: cached?.spaces.length ?? 0,
    fetched_at: cached?.fetched_at || null,
    updated_at: cached?.updated_at || null,
    started_at: cached?.started_at || null,
    ttl_seconds: Math.floor(cacheTtlMs / 1000),
    last_error: cached?.last_error,
  };
}

export function isSafeWebexPaginationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "webexapis.com";
  } catch {
    return false;
  }
}

export function canonicalizeWebexSpaceId(spaceId: string): string {
  const trimmed = spaceId.trim();
  if (!trimmed) return trimmed;
  try {
    const padded = trimmed.padEnd(trimmed.length + ((4 - (trimmed.length % 4)) % 4), "=");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const prefix = "ciscospark://us/ROOM/";
    if (decoded.startsWith(prefix)) {
      const raw = decoded.slice(prefix.length);
      if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(raw)) {
        return raw;
      }
    }
  } catch {
    // Not a Webex public id; keep the admin-provided value unchanged.
  }
  return trimmed;
}

async function listAllRooms(token: string): Promise<NormalizedSpace[]> {
  const out: NormalizedSpace[] = [];
  let url: string | undefined = "https://webexapis.com/v1/rooms?max=100&sortBy=lastactivity";

  for (let page = 0; page < MAX_WEBEX_PAGES && url; page++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      await sleep(Math.min(Math.max(retryAfter, 1) * 1000, 15_000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(
        `Webex API error: HTTP ${res.status}${text ? ` (${text.slice(0, 120)})` : ""}`,
        502
      );
    }

    const data = (await res.json()) as WebexListResponse;
    if (data.items) {
      for (const room of data.items) {
        if (!room.id) continue;
        const canonicalId = canonicalizeWebexSpaceId(room.id);
        out.push({
          id: canonicalId,
          ...(canonicalId === room.id ? {} : { webex_room_id: room.id }),
          name: room.title?.trim() || room.id,
          type: room.type ?? "group",
          is_locked: Boolean(room.isLocked),
        });
      }
    }

    const next = data.link?.find((l) => l.rel === "next")?.href;
    url = next && isSafeWebexPaginationUrl(next) ? next : undefined;
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function applyCursor(spaces: NormalizedSpace[], cursor: string | undefined): NormalizedSpace[] {
  if (!cursor) return spaces;
  const idx = spaces.findIndex((s) => s.name.localeCompare(cursor) > 0);
  return idx < 0 ? [] : spaces.slice(idx);
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

  const token = process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new ApiError(
      "WEBEX_INTEGRATION_BOT_ACCESS_TOKEN is not configured on the UI service. Space discovery is unavailable; admins can still paste space IDs manually.",
      503
    );
  }

  const params = request.nextUrl.searchParams;
  const refresh = params.get("refresh") === "1";
  const q = (params.get("q") ?? "").trim().toLowerCase();
  const cursor = params.get("cursor") ?? undefined;
  const requestedLimit = Number.parseInt(params.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_UI_LIMIT)
      : DEFAULT_UI_LIMIT;

  const now = Date.now();
  const cacheKey = tokenCacheKey(token);
  const cached = cache.get(cacheKey);
  const cacheTtlMs = await getDiscoveryCacheTtlMs();

  let allSpaces: NormalizedSpace[];
  let cacheHit = false;
  let fetchedAt: number;

  // ttl=0 disables caching entirely (admin-controlled debug knob).
  if (!refresh && cacheTtlMs > 0 && cached && now - cached.fetched_at < cacheTtlMs) {
    allSpaces = cached.spaces;
    fetchedAt = cached.fetched_at;
    cacheHit = true;
  } else {
    allSpaces = await listAllRooms(token);
    fetchedAt = now;
    if (cacheTtlMs > 0) {
      cache.set(cacheKey, { spaces: allSpaces, fetched_at: fetchedAt });
    } else {
      cache.delete(cacheKey);
    }
  }

  let filtered = allSpaces;
  if (q) {
    filtered = filtered.filter((s) => s.name.toLowerCase().includes(q));
  }

  const totalMatches = filtered.length;
  const afterCursor = applyCursor(filtered, cursor);
  const page = afterCursor.slice(0, limit);
  const hasMore = afterCursor.length > limit;
  const nextCursor = hasMore ? page[page.length - 1].name : null;

  console.log(
    `[Admin WebexSpaces] discovery ok total=${allSpaces.length} matches=${totalMatches} returned=${page.length} q="${q}" cache=${cacheHit ? "hit" : "miss"} by=${user.email}`
  );

  return successResponse({
    spaces: page,
    total_matches: totalMatches,
    total_visible: allSpaces.length,
    next_cursor: nextCursor,
    has_more: hasMore,
    cached: cacheHit,
    fetched_at: fetchedAt,
    query: { q, limit },
  });
});
