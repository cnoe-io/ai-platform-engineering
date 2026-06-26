// Fetch recent ended Webex meetings for the meeting picker in IngestPanel.
// Returns [] when the project's user has no Webex connection.

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
}

export const GET = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);

  // Resolve Webex token directly — project may not have rooms configured yet
  // but the user might still have a Webex OAuth connection.
  const creds = await resolveForwardedCredentials(tctx, ["webex"]);
  const token = creds["webex"]?.access_token;

  if (!token) {
    return successResponse({ meetings: [] });
  }

  const url = new URL("https://webexapis.com/v1/meetings");
  url.searchParams.set("meetingType", "meeting");
  url.searchParams.set("state", "ended");
  url.searchParams.set("max", "30");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (!res.ok) {
    return successResponse({ meetings: [] });
  }

  const text = await res.text();

  const json = JSON.parse(text) as { items?: Array<{ id?: string; title?: string; start?: string }> };
  const meetings: WebexMeetingListItem[] = (json.items ?? [])
    .filter((m) => m.id && m.title && m.start)
    .map((m) => ({ id: m.id!, title: m.title!, start: m.start! }));

  return successResponse({ meetings });
});
