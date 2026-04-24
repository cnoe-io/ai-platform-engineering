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
 *   We always pull the FULL channel list from Slack once per token (Slack has
 *   no server-side name search for channels) and keep it in-process for
 *   `CACHE_TTL_MS`. Filtering, sorting, and paging happen here on the cached
 *   snapshot so the UI can search/scroll instantly without hammering Slack's
 *   Tier-2 rate limit (20 req/min). Admins can force a refresh via `?refresh=1`.
 *
 *   The Slack walk handles HTTP 429 with the `Retry-After` header so a busy
 *   workspace doesn't break discovery.
 *
 * Failure modes:
 *   - SLACK_BOT_TOKEN unset → 503 (UI falls back to manual channel-ID entry).
 *   - Slack API error → 502 with upstream error code.
 */

import { NextRequest } from "next/server";
import {
  withAuth,
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

interface CacheEntry {
  channels: NormalizedChannel[];
  fetched_at: number;
}

// Channel lists rarely change between admin actions; 10 min keeps us well
// inside Slack's rate limits even when several admins are active.
const CACHE_TTL_MS = 10 * 60_000;
// Slack max page size for conversations.list is 1000, but they recommend
// <=200 for stability. We pull at 200 internally regardless of the UI page
// size (which is just a slice on top of the cache).
const SLACK_PAGE_SIZE = 200;
// Hard ceiling on how many Slack pages we'll walk. 200 channels/page * 100
// pages = 20k channels, more than any realistic workspace.
const MAX_SLACK_PAGES = 100;
// Defensive ceiling on how long we'll sleep waiting for Slack rate limits
// before giving up and 502'ing. Prevents a single request from holding a
// Next.js worker forever.
const MAX_RATE_LIMIT_WAIT_MS = 15_000;
// UI page size caps.
const DEFAULT_UI_LIMIT = 200;
const MAX_UI_LIMIT = 500;

const cache = new Map<string, CacheEntry>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function listAllConversations(token: string): Promise<NormalizedChannel[]> {
  const out: NormalizedChannel[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_SLACK_PAGES; page++) {
    const url = new URL("https://slack.com/api/conversations.list");
    url.searchParams.set("limit", String(SLACK_PAGE_SIZE));
    url.searchParams.set("exclude_archived", "true");
    // public + private; DMs/MPIMs are not assignable to teams.
    url.searchParams.set("types", "public_channel,private_channel");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    // Honor Slack rate-limit responses. Tier-2 = 20 req/min so this is rare
    // when we cache, but it can happen if multiple admins click Refresh
    // simultaneously across UI replicas.
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      const waitMs = Math.min(Math.max(retryAfter, 1) * 1000, MAX_RATE_LIMIT_WAIT_MS);
      console.warn(
        `[Admin SlackChannels] rate-limited by Slack, sleeping ${waitMs}ms (page=${page})`
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
          is_member: Boolean(c.is_member),
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
  return withAuth(request, async (_req, user, session) => {
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

    const now = Date.now();
    // last 12 chars uniquely identifies the token without logging it.
    const cacheKey = token.slice(-12);
    const cached = cache.get(cacheKey);

    let allChannels: NormalizedChannel[];
    let cacheHit = false;
    let fetchedAt: number;

    if (!refresh && cached && now - cached.fetched_at < CACHE_TTL_MS) {
      allChannels = cached.channels;
      fetchedAt = cached.fetched_at;
      cacheHit = true;
    } else {
      allChannels = await listAllConversations(token);
      fetchedAt = now;
      cache.set(cacheKey, { channels: allChannels, fetched_at: fetchedAt });
    }

    // Filter pipeline runs in-process against the cached snapshot.
    let filtered = allChannels;
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
      `[Admin SlackChannels] discovery ok total=${allChannels.length} matches=${totalMatches} returned=${page.length} q="${q}" member_only=${memberOnly} cache=${cacheHit ? "hit" : "miss"} by=${user.email}`
    );

    return successResponse({
      channels: page,
      total_matches: totalMatches,
      total_visible: allChannels.length,
      next_cursor: nextCursor,
      has_more: hasMore,
      cached: cacheHit,
      fetched_at: fetchedAt,
      query: { q, member_only: memberOnly, limit },
    });
  });
});
