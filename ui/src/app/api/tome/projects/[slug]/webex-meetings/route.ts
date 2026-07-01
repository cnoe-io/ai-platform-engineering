// Fetch recorded/transcribed Webex meetings for the ingest meeting picker.
//
// Two Webex sources are unioned so the picker isn't limited to recordings:
//   - GET /v1/recordings         — recordings in the caller's library (host-owned)
//   - GET /v1/meetingTranscripts — transcripts the caller can access
// Transcripts often surface meetings the user attended (not just hosted), which
// recordings alone do not. Both are keyed by meetingId; we merge on it.
//
// Webex semantics we work around (see issue #76):
//   - With no from/to, both endpoints default to a narrow ~7-day window. We page
//     across explicit 30-day windows back `TOME_WEBEX_LOOKBACK_DAYS` days so the
//     full history shows, not just the last week.
//   - /recordings returns the caller's OWN (host-owned) recordings; recordings of
//     meetings hosted by others are not returned under a normal user token. That
//     is a hard Webex limitation — documented, not fixable here.
//
// `?debug=1` returns raw diagnostics (counts + sample items from recordings,
// transcripts, and /meetings) to inspect what the token can actually see.

import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadTomeProject } from "@/lib/tome/tome-api";
import { resolveForwardedCredentials } from "@/lib/tome/agent-proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export interface WebexMeetingListItem {
  id: string;
  title: string;
  start: string;
  hasSummary: boolean;
  hasTranscript: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Webex caps a single from/to query at ~30 days, so page across 30-day windows.
const WINDOW_DAYS = 30;
const LOOKBACK_DAYS = Math.max(
  WINDOW_DAYS,
  Number(process.env.TOME_WEBEX_LOOKBACK_DAYS) || 365,
);
// Safety caps so a large history can't fan out unbounded.
const MAX_PAGES_PER_WINDOW = 10;
const SUMMARY_CHECK_CAP = 100;

/** ISO 8601 without milliseconds (Webex rejects the `.000Z` form). */
function isoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Extract the `rel="next"` URL from a Webex `Link` response header. */
function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (m) return m[1];
  }
  return null;
}

/** GET with one retry on 429 (respecting Retry-After, capped). */
async function wfetch(url: string, headers: Record<string, string>): Promise<Response> {
  const res = await fetch(url, { headers });
  if (res.status !== 429) return res;
  const wait = Math.min(Number(res.headers.get("Retry-After")) || 2, 10);
  await new Promise((r) => setTimeout(r, wait * 1000));
  return fetch(url, { headers });
}

/**
 * Page a Webex list endpoint across 30-day windows back `LOOKBACK_DAYS` days,
 * following the `Link: rel="next"` header within each window. Returns the raw
 * item objects unioned across all windows/pages.
 */
async function fetchWindowed(
  endpoint: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const now = Date.now();
  const items: Record<string, unknown>[] = [];
  for (let off = 0; off < LOOKBACK_DAYS; off += WINDOW_DAYS) {
    const to = new Date(now - off * DAY_MS);
    const from = new Date(now - Math.min(off + WINDOW_DAYS, LOOKBACK_DAYS) * DAY_MS);
    let url: string | null =
      `${endpoint}?max=100&from=${encodeURIComponent(isoNoMs(from))}&to=${encodeURIComponent(isoNoMs(to))}`;
    for (let page = 0; url && page < MAX_PAGES_PER_WINDOW; page++) {
      const res: Response = await wfetch(url, headers);
      if (!res.ok) break;
      const json = (await res.json()) as { items?: Record<string, unknown>[] };
      if (Array.isArray(json.items)) items.push(...json.items);
      url = parseNextLink(res.headers.get("link"));
    }
  }
  return items;
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  const debug = request.nextUrl.searchParams.get("debug") === "1";

  const creds = await resolveForwardedCredentials(tctx);
  const token = creds["webex"]?.access_token;

  if (!token) {
    return successResponse(debug ? { note: "no webex token", meetings: [] } : { meetings: [] });
  }

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  // Recordings + transcripts across the full lookback, in parallel.
  const [recItems, txItems] = await Promise.all([
    fetchWindowed("https://webexapis.com/v1/recordings", headers),
    fetchWindowed("https://webexapis.com/v1/meetingTranscripts", headers),
  ]);

  if (debug) {
    const meetingsProbe = await fetchWindowed("https://webexapis.com/v1/meetings", headers);
    return successResponse({
      lookbackDays: LOOKBACK_DAYS,
      windowDays: WINDOW_DAYS,
      recordings: {
        total: recItems.length,
        withMeetingId: recItems.filter((r) => r.meetingId).length,
        withoutMeetingId: recItems.filter((r) => !r.meetingId).length,
        sample: recItems.slice(0, 3),
      },
      transcripts: {
        total: txItems.length,
        withMeetingId: txItems.filter((t) => t.meetingId).length,
        sample: txItems.slice(0, 3),
      },
      meetings: {
        total: meetingsProbe.length,
        sample: meetingsProbe.slice(0, 3),
      },
    });
  }

  // Merge both sources by meetingId. A recording or a transcript is enough to
  // list (and later ingest) a meeting; downstream fetches summary/transcript by
  // meetingId, so an item without one is unusable — count it, don't show it.
  const byMeeting = new Map<string, { title: string; start: string; hasTranscript: boolean }>();
  let skippedNoMeetingId = 0;

  for (const r of recItems) {
    const meetingId = typeof r.meetingId === "string" ? r.meetingId : "";
    if (!meetingId) {
      skippedNoMeetingId++;
      continue;
    }
    const existing = byMeeting.get(meetingId);
    const title = (typeof r.topic === "string" && r.topic) || existing?.title || "Untitled meeting";
    const start =
      (typeof r.timeRecorded === "string" && r.timeRecorded) ||
      (typeof r.createTime === "string" && r.createTime) ||
      existing?.start ||
      "";
    byMeeting.set(meetingId, { title, start, hasTranscript: existing?.hasTranscript ?? false });
  }

  for (const t of txItems) {
    const meetingId = typeof t.meetingId === "string" ? t.meetingId : "";
    if (!meetingId) continue;
    const existing = byMeeting.get(meetingId);
    const title =
      existing?.title ||
      (typeof t.title === "string" && t.title) ||
      "Untitled meeting";
    const start =
      existing?.start || (typeof t.createTime === "string" && t.createTime) || "";
    byMeeting.set(meetingId, { title, start, hasTranscript: true });
  }

  // Newest first.
  const merged = [...byMeeting.entries()]
    .map(([meetingId, m]) => ({ meetingId, ...m }))
    .sort((a, b) => (b.start || "").localeCompare(a.start || ""));

  // Summary availability per meeting (no global list endpoint). Bounded so a
  // large history doesn't fan out into hundreds of calls.
  const summaryFlags = await Promise.all(
    merged.map(async ({ meetingId }, i) => {
      if (i >= SUMMARY_CHECK_CAP) return false;
      try {
        const res = await wfetch(
          `https://webexapis.com/v1/meetingSummaries?meetingId=${encodeURIComponent(meetingId)}`,
          headers,
        );
        if (!res.ok) return false;
        const j = (await res.json()) as { items?: unknown[] };
        return (j.items?.length ?? 0) > 0;
      } catch {
        return false;
      }
    }),
  );

  const meetings: WebexMeetingListItem[] = merged.map((m, i) => ({
    id: m.meetingId,
    title: m.title,
    start: m.start,
    hasSummary: summaryFlags[i],
    hasTranscript: m.hasTranscript,
  }));

  if (skippedNoMeetingId > 0) {
    console.log(`[webex-meetings] skipped ${skippedNoMeetingId} recording(s) with no meetingId`);
  }

  return successResponse({ meetings });
});
