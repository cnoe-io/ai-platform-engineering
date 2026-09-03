import type { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { sessionSub } from "@/lib/tome/agent-proxy";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { enqueueRun } from "@/lib/tome/ingest-runner";
import { getTomeIngestRunsCollection } from "@/lib/tome/mongo-collections";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import type { ProjectDocument } from "@/types/projects";
import {
  TOME_COLLECTIONS,
  type WebexMeetingOccurrenceDocument,
} from "@/types/tome";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function mongoProjectId(projectId: string): string {
  return (ObjectId.isValid(projectId) ? new ObjectId(projectId) : projectId) as unknown as string;
}

/**
 * Explicitly retry one failed meeting ingest. The failed run remains intact for
 * audit/history; its stored meeting payload is copied into a new meeting-only
 * run so attached project sources can never leak into the retry.
 */
export const POST = withErrorHandler(async (request: NextRequest, context: Ctx) => {
  const { slug } = await context.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  const body = (await request.json().catch(() => null)) as { occurrenceId?: unknown } | null;
  const occurrenceId =
    typeof body?.occurrenceId === "string" ? body.occurrenceId.trim() : "";
  if (!occurrenceId) {
    throw new ApiError("occurrenceId is required", 400, "BAD_REQUEST");
  }

  const occurrences = await getCollection<WebexMeetingOccurrenceDocument>(
    TOME_COLLECTIONS.WEBEX_MEETING_OCCURRENCES,
  );
  const occurrence = await occurrences.findOne({
    _id: occurrenceId,
    project_id: tctx.projectId,
  });
  if (!occurrence) {
    throw new ApiError("Meeting occurrence not found", 404, "NOT_FOUND");
  }
  if (!occurrence.run_id) {
    throw new ApiError(
      "This occurrence has no failed ingest run to retry. Use Sync now to check for its transcript again.",
      409,
      "WEBEX_MEETING_RUN_NOT_RETRYABLE",
    );
  }

  const runs = await getTomeIngestRunsCollection();
  const failedRun = await runs.findOne({
    _id: occurrence.run_id,
    project_id: tctx.projectId,
    status: "failed",
  });
  const meetings = failedRun?.dispatch?.webexMeetings ?? [];
  if (!failedRun || meetings.length === 0) {
    throw new ApiError(
      "The failed run does not contain a reusable Webex meeting payload.",
      409,
      "WEBEX_MEETING_RUN_NOT_RETRYABLE",
    );
  }

  const previousStatus = occurrence.status;
  const claimed = await occurrences.findOneAndUpdate(
    {
      _id: occurrence._id,
      project_id: tctx.projectId,
      run_id: occurrence.run_id,
      status: { $in: ["failed", "queued"] },
    },
    { $set: { status: "processing", updated_at: new Date() } },
    { returnDocument: "after" },
  );
  if (!claimed) {
    throw new ApiError(
      "This meeting ingest is already being retried or is no longer failed.",
      409,
      "WEBEX_MEETING_RETRY_CONFLICT",
    );
  }

  let runId: string;
  try {
    runId = await enqueueRun(
      { ...tctx.project, _id: tctx.projectId },
      {
        sub: sessionSub(tctx.session),
        email: tctx.user.email ?? null,
        triggeredBy: "manual",
        dispatch: {
          endpoint: "/ingest",
          sourceScope: "webex_meetings",
          seed: null,
          mode: "quick",
          triggeredBy: "manual",
          meetingOccurrenceId: occurrence._id,
          webexMeetings: meetings,
        },
      },
    );
  } catch (error) {
    await occurrences.updateOne(
      { _id: occurrence._id, status: "processing", run_id: occurrence.run_id },
      { $set: { status: previousStatus, updated_at: new Date() } },
    );
    throw error;
  }

  const now = new Date();
  await occurrences.updateOne(
    { _id: occurrence._id, status: "processing", run_id: occurrence.run_id },
    {
      $set: {
        status: "queued",
        run_id: runId,
        next_attempt_at: now,
        last_error: "",
        updated_at: now,
      },
    },
  );

  const projects = await getCollection<ProjectDocument>("projects");
  await projects.updateOne(
    {
      _id: mongoProjectId(tctx.projectId),
      "autoIngest.webexMeetingSeries.id": occurrence.subscription_id,
    },
    {
      $set: {
        "autoIngest.webexMeetingSeries.$.lastOccurrenceAt": occurrence.start.toISOString(),
        "autoIngest.webexMeetingSeries.$.lastRunId": runId,
        "autoIngest.webexMeetingSeries.$.lastStatus": "queued",
        "autoIngest.webexMeetingSeries.$.lastError": "",
        updated_at: now,
      },
    },
  );

  auditTome({
    action: "tome.webex_meeting_series.retry",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: {
      occurrence_id: occurrence._id,
      previous_run_id: occurrence.run_id,
      retry_run_id: runId,
    },
  });

  return successResponse(
    {
      occurrenceId: occurrence._id,
      previousRunId: occurrence.run_id,
      runId,
      status: "queued",
    },
    202,
  );
});
