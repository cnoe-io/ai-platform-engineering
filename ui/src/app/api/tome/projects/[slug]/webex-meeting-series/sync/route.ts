import type { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import {
  previewWebexMeetingSeriesBackfill,
  queueWebexMeetingSeriesBackfill,
} from "@/lib/tome/auto-ingest/webex-meeting-series-backfill";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { isSynthesizedType } from "@/types/projects";
import type { ProjectDocument, WebexMeetingSeriesSubscription } from "@/types/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function subscriptionFor(
  project: ProjectDocument,
  subscriptionId: string,
): WebexMeetingSeriesSubscription {
  if (isSynthesizedType(project.type)) {
    throw new ApiError(
      "Meeting-series ingestion is available on projects, not synthesized entities.",
      400,
      "MEETING_SERIES_PROJECT_REQUIRED",
    );
  }
  const subscription = project.autoIngest?.webexMeetingSeries?.find(
    (item) => item.id === subscriptionId,
  );
  if (!subscription) {
    throw new ApiError("Meeting-series subscription not found", 404, "NOT_FOUND");
  }
  return subscription;
}

export const GET = withErrorHandler(async (request: NextRequest, context: Ctx) => {
  const { slug } = await context.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  const subscriptionId = request.nextUrl.searchParams.get("subscriptionId")?.trim() ?? "";
  if (!subscriptionId) {
    throw new ApiError("subscriptionId is required", 400, "BAD_REQUEST");
  }
  const subscription = subscriptionFor(tctx.project, subscriptionId);
  const preview = await previewWebexMeetingSeriesBackfill(
    { ...tctx.project, _id: tctx.projectId },
    subscription,
  );
  return successResponse({ subscriptionId, ...preview });
});

export const POST = withErrorHandler(async (request: NextRequest, context: Ctx) => {
  const { slug } = await context.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  const body = (await request.json().catch(() => null)) as {
    subscriptionId?: unknown;
    occurrenceKeys?: unknown;
  } | null;
  const subscriptionId =
    typeof body?.subscriptionId === "string" ? body.subscriptionId.trim() : "";
  const occurrenceKeys = Array.isArray(body?.occurrenceKeys)
    ? [
        ...new Set(
          body.occurrenceKeys
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  if (!subscriptionId || occurrenceKeys.length === 0) {
    throw new ApiError(
      "subscriptionId and at least one occurrence key are required",
      400,
      "BAD_REQUEST",
    );
  }
  if (occurrenceKeys.length > 200) {
    throw new ApiError("At most 200 meeting occurrences can be queued at once", 400, "BAD_REQUEST");
  }
  const subscription = subscriptionFor(tctx.project, subscriptionId);
  if (!subscription.enabled) {
    throw new ApiError(
      "Enable this meeting series before queuing historical occurrences.",
      409,
      "MEETING_SERIES_DISABLED",
    );
  }
  const result = await queueWebexMeetingSeriesBackfill(
    { ...tctx.project, _id: tctx.projectId },
    subscription,
    occurrenceKeys,
  );
  auditTome({
    action: "tome.webex_meeting_series.backfill",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: {
      subscription_id: subscriptionId,
      requested_count: occurrenceKeys.length,
      queued_count: result.queuedCount,
    },
  });
  return successResponse(result);
});
