/**
 * Spec 098 US9 — Slack channel discovery for the team-assignment UI.
 *
 * GET /api/admin/slack/available-channels
 *   Returns Slack channels the bot can see, with server-side search + paging
 *   so the picker scales to workspaces with thousands of channels.
 *
 * Query params:
 *   - `q`            — case-insensitive substring filter on channel name.
 *   - `member_only`  — `1` (default) restricts to channels the bot is a
 *                      member of. `0` includes every public/private channel
 *                      the token can see.
 *   - `limit`        — page size (default 200, max 500).
 *   - `cursor`       — opaque alphabetical cursor returned in the previous
 *                      response. Empty/absent ⇒ first page.
 *   - `refresh`      — `1` invalidates the in-process cache before serving.
 *
 * Auth: requires `admin_ui:view`.
 *
 * Caching strategy:
 *   We pull a snapshot of channels from Slack once per (token, scope) and keep
 *   it in-process for `CACHE_TTL_MS`. Filtering, sorting, and paging happen
 *   here on the cached snapshot so the UI can search/scroll instantly without
 *   hammering Slack's rate limits. Admins can force a refresh via `?refresh=1`.
 *
 *   Endpoint selection (fixes #1506):
 *     - `member_only=1` (default)  → `users.conversations` (Tier 3, ~50 req/min).
 *       Returns ONLY channels the bot is a member of. This is what the admin UI
 *       almost always wants and is orders of magnitude smaller than the whole
 *       workspace, which keeps us off Slack's Tier-2 rate limit in big tenants.
 *     - `member_only=0`            → `conversations.list` (Tier 2, ~20 req/min).
 *       Returns every public/private channel the token can see. Used only when
 *       an admin explicitly opts in (e.g. assigning the bot to a brand new
 *       channel). The cache softens the rate-limit blast radius.
 *
 *   The two scopes have separate cache entries because their result sets are
 *   different — mixing them would either pollute member-only with non-member
 *   channels or starve full-list mode.
 *
 *   Both walks handle HTTP 429 with the `Retry-After` header so a busy
 *   workspace doesn't break discovery.
 *
 * Failure modes:
 *   - SLACK_BOT_TOKEN unset → 503 (UI falls back to manual channel-ID entry).
 *   - Slack API error → 502 with upstream error code.
 *
 * assisted-by Claude Claude-opus-4-7
 */

import { NextRequest } from "next/server";
import {
  getAuthFromBearerOrSession,
  withErrorHandler,
  successResponse,
  requireRbacPermission,
  ApiError,
} from "@/lib/api-middleware";

interface SlackConversation {
  id: string;
  name?: string;
  is_archived?: boolean;
  is_private?: boolean;
  is_member?: boolean;
  num_members?: number;
}

interface SlackListResponse {
  ok: boolean;
  error?: string;
  channels?: SlackConversation[];
  response_metadata?: { next_cursor?: string };
}

interface NormalizedChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  num_members: number;
}

type DiscoveryScope = "member_only" | "all";

interface CacheEntry {
  channels: NormalizedChannel[];
  fetched_at: number;
  endpoint: "users.conversations" | "conversations.list";
}

// Channel lists rarely change between admin actions; 10 min keeps us well
// inside Slack's rate limits even when several admins are active.
const CACHE_TTL_MS = 10 * 60_000;
// Slack max page size is 1000 for conversations.list / 999 for
// users.conversations, but Slack recommends <=200 for stability. We pull at
// 200 internally regardless of the UI page size (which is just a slice on top
// of the cache).
const SLACK_PAGE_SIZE = 200;
// Hard ceiling on how many Slack pages we'll walk per scope.
//   - member_only (users.conversations): 200 * 50 = 10k channels, far more than
//     any sane bot membership.
//   - all (conversations.list): 200 * 100 = 20k channels, more than any
//     realistic workspace.
const MAX_SLACK_PAGES_MEMBER = 50;
const MAX_SLACK_PAGES_ALL = 100;
// Defensive ceiling on how long we'll sleep waiting for Slack rate limits
// before giving up and 502'ing. Prevents a single request from holding a
// Next.js worker forever.
const MAX_RATE_LIMIT_WAIT_MS = 15_000;
// UI page size caps.
const DEFAULT_UI_LIMIT = 200;
const MAX_UI_LIMIT = 500;

const cache = new Map<string, CacheEntry>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Test-only helper. Lets us reset the in-process cache between unit tests so
 * one test's snapshot doesn't bleed into the next. Not exported in production
 * code paths — it's a no-op for callers that don't import it.
 */
export function __resetAvailableChannelsCacheForTests(): void {
  cache.clear();
}

/**
 * Walk a Slack conversations endpoint and accumulate normalized channels.
 *
 * The two supported endpoints (`users.conversations` for member-only and
 * `conversations.list` for full workspace) share the same response shape, so
 * we parameterise endpoint, page cap, and is_member defaulting and reuse the
 * pagination + rate-limit loop.
 */
async function walkSlackConversations(
  token: string,
  endpoint: "users.conversations" | "conversations.list",
  options: { maxPages: number; defaultIsMember: boolean }
): Promise<NormalizedChannel[]> {
  const out: NormalizedChannel[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < options.maxPages; page++) {
    const url = new URL(`https://slack.com/api/${endpoint}`);
    url.searchParams.set("limit", String(SLACK_PAGE_SIZE));
    url.searchParams.set("exclude_archived", "true");
    // public + private; DMs/MPIMs are not assignable to teams.
    url.searchParams.set("types", "public_channel,private_channel");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    // Honor Slack rate-limit responses. Even on Tier 3 this can happen if
    // multiple admins click Refresh simultaneously across UI replicas.
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      const waitMs = Math.min(Math.max(retryAfter, 1) * 1000, MAX_RATE_LIMIT_WAIT_MS);
      console.warn(
        `[Admin SlackChannels] rate-limited by Slack ${endpoint}, sleeping ${waitMs}ms (page=${page})`
      );
      await sleep(waitMs);
      continue; // retry same cursor
    }

    const data = (await res.json()) as SlackListResponse;
    if (!data.ok) {
      throw new ApiError(
        `Slack API error: ${data.error ?? "unknown"} (status ${res.status})`,
        502
      );
    }

    if (data.channels) {
      for (const c of data.channels) {
        if (c.is_archived) continue;
        out.push({
          id: c.id,
          name: c.name ?? c.id,
          is_private: Boolean(c.is_private),
          // `users.conversations` omits `is_member` (per Slack docs) since by
          // definition every row is one the bot is in. Default accordingly so
          // downstream filters and the UI's `channel.is_member !== false`
          // check both behave correctly.
          is_member: c.is_member ?? options.defaultIsMember,
          num_members: c.num_members ?? 0,
        });
      }
    }

    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  // Sort once at fetch time so cursor-based paging downstream is stable.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Find the next item strictly greater than `cursor` (alphabetical) in the
 * sorted list. Cursor is just the channel name of the last returned row.
 */
function applyCursor(
  channels: NormalizedChannel[],
  cursor: string | undefined
): NormalizedChannel[] {
  if (!cursor) return channels;
  // O(log n) would need binary search; n <= ~20k so linear is fine and
  // avoids subtle locale-collation bugs.
  const idx = channels.findIndex((c) => c.name.localeCompare(cursor) > 0);
  return idx < 0 ? [] : channels.slice(idx);
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) {
    throw new ApiError(
      "SLACK_BOT_TOKEN is not configured on the UI service. Channel discovery is unavailable; admins can still paste channel IDs manually.",
      503
    );
  }

  const params = request.nextUrl.searchParams;
  const refresh = params.get("refresh") === "1";
  const q = (params.get("q") ?? "").trim().toLowerCase();
  const memberOnly = params.get("member_only") !== "0"; // default ON
  const cursor = params.get("cursor") ?? undefined;
  const requestedLimit = Number.parseInt(params.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_UI_LIMIT)
      : DEFAULT_UI_LIMIT;

  const scope: DiscoveryScope = memberOnly ? "member_only" : "all";
  const endpoint: "users.conversations" | "conversations.list" = memberOnly
    ? "users.conversations"
    : "conversations.list";
  const maxPages = memberOnly ? MAX_SLACK_PAGES_MEMBER : MAX_SLACK_PAGES_ALL;

  const now = Date.now();
  // last 12 chars uniquely identifies the token without logging it. Scope is
  // part of the key so the two endpoints don't poison each other's snapshot.
  const cacheKey = `${scope}:${token.slice(-12)}`;
  const cached = cache.get(cacheKey);

  let snapshot: NormalizedChannel[];
  let cacheHit = false;
  let fetchedAt: number;

  if (!refresh && cached && now - cached.fetched_at < CACHE_TTL_MS) {
    snapshot = cached.channels;
    fetchedAt = cached.fetched_at;
    cacheHit = true;
  } else {
    snapshot = await walkSlackConversations(token, endpoint, {
      maxPages,
      defaultIsMember: memberOnly,
    });
    fetchedAt = now;
    cache.set(cacheKey, { channels: snapshot, fetched_at: fetchedAt, endpoint });
  }

  // Filter pipeline runs in-process against the cached snapshot.
  // NOTE: when scope is "member_only" the snapshot is already members-only
  // (users.conversations returns only those rows), so this filter is a no-op
  // there. Keep it for defence-in-depth against a future provider that
  // returns extras.
  let filtered = snapshot;
  if (memberOnly) {
    filtered = filtered.filter((c) => c.is_member);
  }
  if (q) {
    filtered = filtered.filter((c) => c.name.toLowerCase().includes(q));
  }

  const totalMatches = filtered.length;
  const afterCursor = applyCursor(filtered, cursor);
  const page = afterCursor.slice(0, limit);
  const hasMore = afterCursor.length > limit;
  const nextCursor = hasMore ? page[page.length - 1].name : null;

  console.log(
    `[Admin SlackChannels] discovery ok scope=${scope} endpoint=${endpoint} total=${snapshot.length} matches=${totalMatches} returned=${page.length} q="${q}" cache=${cacheHit ? "hit" : "miss"} by=${user.email}`
  );

  return successResponse({
    channels: page,
    total_matches: totalMatches,
    total_visible: snapshot.length,
    next_cursor: nextCursor,
    has_more: hasMore,
    cached: cacheHit,
    fetched_at: fetchedAt,
    scope,
    endpoint,
    query: { q, member_only: memberOnly, limit },
  });
});
