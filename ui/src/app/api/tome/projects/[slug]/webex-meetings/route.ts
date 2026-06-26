// Fetch recorded Webex meetings for the ingest meeting picker.
// Returns meetings that have a recording, with per-meeting flags for whether
// an AI summary and/or transcript are available.

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

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);

  const creds = await resolveForwardedCredentials(tctx);
  const token = creds["webex"]?.access_token;

  if (!token) {
    return successResponse({ meetings: [] });
  }

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  // Step 1: get recordings + all transcripts in parallel.
  const [recRes, txRes] = await Promise.all([
    fetch("https://webexapis.com/v1/recordings?max=100", { headers }),
    fetch("https://webexapis.com/v1/meetingTranscripts?max=100", { headers }),
  ]);

  if (!recRes.ok) {
    return successResponse({ meetings: [] });
  }

  const recJson = (await recRes.json()) as {
    items?: Array<{ meetingId?: string; topic?: string; timeRecorded?: string; createTime?: string }>;
  };
  const txJson = txRes.ok
    ? ((await txRes.json()) as { items?: Array<{ meetingId?: string }> })
    : { items: [] };

  const transcriptIds = new Set((txJson.items ?? []).map((t) => t.meetingId).filter(Boolean));

  // Deduplicate recordings by meetingId.
  const seen = new Set<string>();
  const deduped: Array<{ meetingId: string; topic: string; start: string }> = [];
  for (const r of recJson.items ?? []) {
    if (!r.meetingId || !r.topic || seen.has(r.meetingId)) continue;
    seen.add(r.meetingId);
    deduped.push({ meetingId: r.meetingId, topic: r.topic, start: r.timeRecorded ?? r.createTime ?? "" });
  }

  // Step 2: check summary availability per meeting in parallel.
  // meetingSummaries requires a meetingId — no global list endpoint.
  const summaryFlags = await Promise.all(
    deduped.map(async ({ meetingId }) => {
      try {
        const res = await fetch(
          `https://webexapis.com/v1/meetingSummaries?meetingId=${encodeURIComponent(meetingId)}`,
          { headers },
        );
        const body = await res.text();
        console.log(`[webex-meetings] summary ${meetingId} status=${res.status} body=${body.slice(0, 200)}`);
        if (!res.ok) return false;
        const j = JSON.parse(body) as { items?: unknown[] };
        return (j.items?.length ?? 0) > 0;
      } catch {
        return false;
      }
    }),
  );

  const meetings: WebexMeetingListItem[] = deduped.map((r, i) => ({
    id: r.meetingId,
    title: r.topic,
    start: r.start,
    hasSummary: summaryFlags[i],
    hasTranscript: transcriptIds.has(r.meetingId),
  }));

  return successResponse({ meetings });
});
