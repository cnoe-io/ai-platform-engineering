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

  const creds = await resolveForwardedCredentials(tctx, ["webex"]);
  const token = creds["webex"]?.access_token;

  if (!token) {
    return successResponse({ meetings: [] });
  }

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  // Three parallel calls: recordings (source of truth for "was captured"),
  // summaries and transcripts (availability flags).
  const [recRes, sumRes, txRes] = await Promise.all([
    fetch("https://webexapis.com/v1/recordings?max=30", { headers }),
    fetch("https://webexapis.com/v1/meetingSummaries?max=100", { headers }),
    fetch("https://webexapis.com/v1/meetingTranscripts?max=100", { headers }),
  ]);

  if (!recRes.ok) {
    return successResponse({ meetings: [] });
  }

  const [recJson, sumJson, txJson] = await Promise.all([
    recRes.json() as Promise<{ items?: Array<{ meetingId?: string; topic?: string; timeRecorded?: string; createTime?: string }> }>,
    sumRes.ok ? (sumRes.json() as Promise<{ items?: Array<{ meetingId?: string }> }>) : Promise.resolve({ items: [] }),
    txRes.ok  ? (txRes.json()  as Promise<{ items?: Array<{ meetingId?: string }> }>) : Promise.resolve({ items: [] }),
  ]);

  const summaryIds  = new Set((sumJson.items ?? []).map((s) => s.meetingId).filter(Boolean));
  const transcriptIds = new Set((txJson.items  ?? []).map((t) => t.meetingId).filter(Boolean));

  // Deduplicate by meetingId (a meeting can have multiple recording segments).
  const seen = new Set<string>();
  const meetings: WebexMeetingListItem[] = [];
  for (const r of recJson.items ?? []) {
    if (!r.meetingId || !r.topic) continue;
    if (seen.has(r.meetingId)) continue;
    seen.add(r.meetingId);
    meetings.push({
      id: r.meetingId,
      title: r.topic,
      start: r.timeRecorded ?? r.createTime ?? "",
      hasSummary: summaryIds.has(r.meetingId),
      hasTranscript: transcriptIds.has(r.meetingId),
    });
  }

  return successResponse({ meetings });
});
