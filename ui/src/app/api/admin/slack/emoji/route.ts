import { NextRequest } from "next/server";
import {
  getAuthFromBearerOrSession,
  withErrorHandler,
  successResponse,
  requireRbacPermission,
  ApiError,
} from "@/lib/api-middleware";

interface SlackEmojiListResponse {
  ok: boolean;
  error?: string;
  emoji?: Record<string, string>;
  categories?: Array<{
    name?: string;
    emoji_names?: string[];
    emojis?: string[];
  }>;
}

interface SlackEmojiResult {
  name: string;
  url?: string;
  alias_for?: string;
}

interface CacheEntry {
  emoji: SlackEmojiResult[];
  fetched_at: number;
  refreshing?: Promise<SlackEmojiResult[]>;
  last_error?: string;
  started_at?: number;
  updated_at?: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MAX_RATE_LIMIT_WAIT_MS = 15_000;
const EMOJI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RATE_LIMIT_RETRIES = 3;

const cache = new Map<string, CacheEntry>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Slack's `emoji.list` may omit Unicode categories depending on token/app
// behavior even when `include_categories=true`; keep common standard reaction
// names available so admins can still choose normal Slack reactions.
const STANDARD_SLACK_EMOJI_NAMES = [
  "eyes", "eye", "eye_speech_bubble", "white_check_mark", "x", "warning",
  "rotating_light", "fire", "rocket", "wave", "raised_hands", "pray",
  "thumbsup", "+1", "thumbsdown", "-1", "clap", "heart", "blue_heart",
  "green_heart", "yellow_heart", "purple_heart", "red_circle", "large_green_circle",
  "large_yellow_circle", "information_source", "question", "grey_question",
  "heavy_check_mark", "heavy_multiplication_x", "bell", "mega", "loudspeaker",
  "memo", "pushpin", "paperclip", "link", "hourglass_flowing_sand", "stopwatch",
  "construction", "hammer_and_wrench", "wrench", "gear", "bug", "lock", "unlock",
  "shield", "robot_face", "technologist", "male-technologist", "female-technologist",
  "see_no_evil", "hear_no_evil", "speak_no_evil", "thinking_face", "face_with_monocle",
  "slightly_smiling_face", "neutral_face", "confused", "sob", "tada", "sparkles",
];

export function __resetSlackEmojiCacheForTests(): void {
  cache.clear();
}

async function fetchSlackEmoji(token: string, attempt = 0): Promise<SlackEmojiResult[]> {
  const url = new URL("https://slack.com/api/emoji.list");
  url.searchParams.set("include_categories", "true");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMessage = cause instanceof Error ? `${cause.name}: ${cause.message}` : err instanceof Error ? err.message : String(err);
    throw new ApiError(`Slack emoji lookup network failure: ${causeMessage}`, 502);
  }

  if (res.status === 429) {
    if (attempt >= MAX_RATE_LIMIT_RETRIES) {
      throw new ApiError(`Slack API rate limited emoji.list after ${MAX_RATE_LIMIT_RETRIES} retries`, 429);
    }
    const retryAfter = Number(res.headers.get("retry-after") ?? "1");
    const backoffMs = 2 ** attempt * 1000;
    const waitMs = Math.min(Math.max(retryAfter, 1) * 1000 + backoffMs, MAX_RATE_LIMIT_WAIT_MS);
    await sleep(waitMs);
    return fetchSlackEmoji(token, attempt + 1);
  }

  let data: SlackEmojiListResponse;
  try {
    data = (await res.json()) as SlackEmojiListResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(`Slack emoji lookup returned a non-JSON response (status ${res.status}): ${message}`, 502);
  }

  if (!data.ok) {
    throw new ApiError(`Slack API error: ${data.error ?? "unknown"}`, 502);
  }

  const byName = new Map<string, SlackEmojiResult>();
  for (const name of STANDARD_SLACK_EMOJI_NAMES) {
    byName.set(name, { name });
  }
  for (const category of data.categories ?? []) {
    for (const name of [...(category.emoji_names ?? []), ...(category.emojis ?? [])]) {
      if (name && !byName.has(name)) byName.set(name, { name });
    }
  }
  for (const [name, value] of Object.entries(data.emoji ?? {})) {
    byName.set(name, value.startsWith("alias:")
      ? { name, alias_for: value.slice("alias:".length) }
      : { name, url: value });
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function refreshSlackEmojiCache(token: string, cacheKey: string): Promise<SlackEmojiResult[]> {
  const existing = cache.get(cacheKey);
  if (existing?.refreshing) return existing.refreshing;

  const refreshing = fetchSlackEmoji(token)
    .then((emoji) => {
      cache.set(cacheKey, {
        emoji,
        fetched_at: Date.now(),
        started_at: existing?.started_at,
        updated_at: Date.now(),
      });
      return emoji;
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      cache.set(cacheKey, {
        emoji: existing?.emoji ?? [],
        fetched_at: existing?.fetched_at ?? 0,
        last_error: message,
        started_at: existing?.started_at,
        updated_at: Date.now(),
      });
      throw err;
    });

  cache.set(cacheKey, {
    emoji: existing?.emoji ?? [],
    fetched_at: existing?.fetched_at ?? 0,
    refreshing,
    last_error: existing?.last_error,
    started_at: Date.now(),
    updated_at: Date.now(),
  });
  return refreshing;
}

export function warmSlackEmojiDirectory(token: string): void {
  const cacheKey = token.slice(-12);
  const cached = cache.get(cacheKey);
  const fresh = cached?.emoji.length && Date.now() - cached.fetched_at < EMOJI_CACHE_TTL_MS;
  if (!fresh) {
    void refreshSlackEmojiCache(token, cacheKey).catch((err) => {
      console.warn("[Admin SlackEmoji] background refresh failed", err);
    });
  }
}

export function getSlackEmojiDirectoryStatus(token: string) {
  const cached = cache.get(token.slice(-12));
  const now = Date.now();
  const hasSnapshot = Boolean(cached?.emoji.length);
  const fresh = Boolean(hasSnapshot && cached && now - cached.fetched_at < EMOJI_CACHE_TTL_MS);
  return {
    status: cached?.refreshing ? "warming" : fresh ? "ready" : hasSnapshot ? "stale" : "empty",
    emoji_indexed: cached?.emoji.length ?? 0,
    fetched_at: cached?.fetched_at || null,
    updated_at: cached?.updated_at || null,
    started_at: cached?.started_at || null,
    ttl_seconds: Math.floor(EMOJI_CACHE_TTL_MS / 1000),
    last_error: cached?.last_error,
  };
}

function fuzzyScore(value: string, query: string): number {
  const normalized = value.toLowerCase();
  if (!normalized || !query) return Number.POSITIVE_INFINITY;
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 10 + normalized.length - query.length;
  const wordStartIndex = normalized.search(new RegExp(`(^|[\\s._+-])${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
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

function emojiSearchScore(entry: SlackEmojiResult, query: string): number {
  return Math.min(
    fuzzyScore(entry.name, query),
    fuzzyScore(entry.alias_for ?? "", query),
  );
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) {
    throw new ApiError("SLACK_BOT_TOKEN is not configured on the UI service. Slack emoji lookup is unavailable.", 503);
  }

  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim().replace(/^:|:$/g, "").toLowerCase();
  const refresh = params.get("refresh") === "1";
  const requestedLimit = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;

  const now = Date.now();
  const cacheKey = token.slice(-12);
  const cached = cache.get(cacheKey);
  const hasSnapshot = Boolean(cached && cached.emoji.length > 0);
  const cacheFresh = hasSnapshot && now - (cached?.fetched_at ?? 0) < EMOJI_CACHE_TTL_MS;

  if (refresh || !cacheFresh) {
    void refreshSlackEmojiCache(token, cacheKey).catch((err) => {
      console.warn("[Admin SlackEmoji] background refresh failed", err);
    });
  }

  if (!hasSnapshot) {
    return successResponse({
      emoji: [],
      total_matches: 0,
      total_visible: 0,
      cached: false,
      warming: true,
      fetched_at: cached?.fetched_at ?? 0,
      error: cached?.last_error,
      query: { q, limit },
    });
  }

  const filtered = q
    ? cached!.emoji
        .map((entry) => ({ entry, score: emojiSearchScore(entry, q) }))
        .filter((entry) => Number.isFinite(entry.score))
        .sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name))
        .map((entry) => entry.entry)
    : cached!.emoji;

  return successResponse({
    emoji: filtered.slice(0, limit),
    total_matches: filtered.length,
    total_visible: cached!.emoji.length,
    cached: true,
    refreshing: !cacheFresh,
    fetched_at: cached!.fetched_at,
    query: { q, limit },
  });
});
