import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { sessionSub } from "@/lib/tome/agent-proxy";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { requestWebexMeetingOwnerCheck } from "@/lib/tome/auto-ingest/cursor";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";
import { loadWebexMeetingOccurrenceHistory } from "@/lib/tome/webex-meeting-history";
import {
  discoverMeetingSeries,
  interactiveWebexMeetingInvoker,
  meetingSeriesHostEligibility,
  meetingSeriesSlug,
  meetingSeriesMatches,
} from "@/lib/tome/webex-meeting-series";
import { isSynthesizedType } from "@/types/projects";
import type {
  AutoIngestConfig,
  ProjectDocument,
  WebexMeetingSeriesSubscription,
} from "@/types/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function mongoProjectId(projectId: string): string {
  return (ObjectId.isValid(projectId) ? new ObjectId(projectId) : projectId) as unknown as string;
}

function discoveryWindow(now = new Date()): { from: Date; to: Date; now: Date } {
  return {
    from: new Date(now.getTime() - 48 * 60 * 60 * 1000),
    to: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
    now,
  };
}

function requireRegularProject(project: ProjectDocument): void {
  if (isSynthesizedType(project.type)) {
    throw new ApiError(
      "Meeting-series ingestion is available on projects, not synthesized entities.",
      400,
      "MEETING_SERIES_PROJECT_REQUIRED",
    );
  }
}

function sessionName(session: unknown, fallback: string): string {
  if (session && typeof session === "object" && "user" in session) {
    const user = (session as { user?: { name?: unknown } }).user;
    if (typeof user?.name === "string" && user.name.trim()) return user.name.trim();
  }
  return fallback;
}

export const GET = withErrorHandler(async (request: NextRequest, context: Ctx) => {
  const { slug } = await context.params;
  const tctx = await loadTomeProject(request, slug);
  requireRegularProject(tctx.project);
  const subscriptions = tctx.project.autoIngest?.webexMeetingSeries ?? [];
  const occurrences = await loadWebexMeetingOccurrenceHistory(
    tctx.projectId,
    subscriptions.map((subscription) => subscription.id),
  );

  if (request.nextUrl.searchParams.get("discover") !== "1") {
    return successResponse({ subscriptions, occurrences, canEdit: tctx.canEdit });
  }

  requireTomeEditor(tctx);
  const invoke = await interactiveWebexMeetingInvoker(request, tctx);
  const now = new Date();
  const candidates = (await discoverMeetingSeries(invoke, discoveryWindow(now))).map((candidate) => ({
    ...candidate,
    ...meetingSeriesHostEligibility(candidate, tctx.user.email),
  }));
  const ownerSubject = sessionSub(tctx.session);
  const refreshedSubscriptions = subscriptions.map((subscription) => {
    if (!ownerSubject || subscription.credentialOwner.subject !== ownerSubject) return subscription;
    const candidate = candidates.find((item) => meetingSeriesMatches(item, subscription));
    if (!candidate) return subscription;
    return {
      ...subscription,
      title: candidate.title,
      siteUrl: candidate.siteUrl || subscription.siteUrl,
      lastCalendarCheckAt: now.toISOString(),
      nextOccurrenceStartAt: candidate.nextOccurrence?.start,
      nextOccurrenceEndAt: candidate.nextOccurrence?.end,
    };
  });

  if (ownerSubject) {
    const sites = new Set(
      subscriptions
        .filter((subscription) => subscription.credentialOwner.subject === ownerSubject)
        .map((subscription) => subscription.siteUrl?.trim().replace(/\/+$/, "") ?? ""),
    );
    await Promise.all(
      [...sites].map((siteUrl) => requestWebexMeetingOwnerCheck(ownerSubject, siteUrl, now)),
    );
  }

  return successResponse({
    subscriptions: refreshedSubscriptions,
    occurrences,
    candidates,
    canEdit: true,
  });
});

export const POST = withErrorHandler(async (request: NextRequest, context: Ctx) => {
  const { slug } = await context.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  requireRegularProject(tctx.project);

  const body = (await request.json().catch(() => null)) as { seriesKey?: unknown } | null;
  const seriesKey = typeof body?.seriesKey === "string" ? body.seriesKey.trim() : "";
  if (!seriesKey) {
    throw new ApiError("Meeting series is required", 400, "MEETING_SERIES_REQUIRED");
  }

  const invoke = await interactiveWebexMeetingInvoker(request, tctx);
  const candidate = (await discoverMeetingSeries(invoke, discoveryWindow())).find(
    (item) => item.seriesKey === seriesKey,
  );
  if (!candidate) {
    throw new ApiError(
      "That recurring meeting is no longer available from Webex.",
      404,
      "MEETING_SERIES_NOT_FOUND",
    );
  }
  const eligibility = meetingSeriesHostEligibility(candidate, tctx.user.email);
  if (!eligibility.canAutoIngest) {
    throw new ApiError(
      eligibility.unavailableReason || "Only meetings hosted by you can be auto-ingested.",
      403,
      "WEBEX_MEETING_HOST_REQUIRED",
    );
  }

  const existing = tctx.project.autoIngest?.webexMeetingSeries ?? [];
  const duplicate = existing.find((item) => meetingSeriesMatches(candidate, item));
  if (duplicate) return successResponse({ subscription: duplicate, created: false });

  const subject = sessionSub(tctx.session);
  const email = tctx.user.email?.trim().toLowerCase() ?? "";
  if (!subject || !email) {
    throw new ApiError("Sign in again before adding a meeting series.", 401, "NOT_SIGNED_IN");
  }
  const now = new Date();
  const baseSeriesSlug = meetingSeriesSlug(candidate.title, candidate.seriesKey);
  const seriesSlug = existing.some((item) => item.seriesSlug === baseSeriesSlug)
    ? `${baseSeriesSlug}-${meetingSeriesSlug("", candidate.seriesKey).replace(/^meeting-/, "")}`
    : baseSeriesSlug;
  const subscription: WebexMeetingSeriesSubscription = {
    id: randomUUID(),
    enabled: true,
    seriesKey: candidate.seriesKey,
    seriesSlug,
    title: candidate.title,
    siteUrl: candidate.siteUrl,
    sourceRefs: candidate.sourceRefs,
    credentialOwner: {
      subject,
      email,
      name: sessionName(tctx.session, email),
      confirmedAt: now.toISOString(),
    },
    createdAt: now.toISOString(),
    nextOccurrenceStartAt: candidate.nextOccurrence?.start,
    nextOccurrenceEndAt: candidate.nextOccurrence?.end,
    lastStatus: "pending",
  };

  const autoIngest: AutoIngestConfig = tctx.project.autoIngest ?? {
    enabled: false,
    cron: "0 9 * * *",
    credentialOwner: null,
  };
  autoIngest.webexMeetingSeries = [...existing, subscription];

  const projects = await getCollection<ProjectDocument>("projects");
  await projects.updateOne(
    { _id: mongoProjectId(tctx.projectId) },
    { $set: { autoIngest, updated_at: now } },
  );
  auditTome({
    action: "tome.webex_meeting_series.create",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: { subscription_id: subscription.id, series_key: subscription.seriesKey },
  });
  return successResponse({ subscription, created: true }, 201);
});

export const PATCH = withErrorHandler(async (request: NextRequest, context: Ctx) => {
  const { slug } = await context.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  requireRegularProject(tctx.project);

  const body = (await request.json().catch(() => null)) as {
    subscriptionId?: unknown;
    enabled?: unknown;
  } | null;
  const subscriptionId =
    typeof body?.subscriptionId === "string" ? body.subscriptionId.trim() : "";
  if (!subscriptionId || typeof body?.enabled !== "boolean") {
    throw new ApiError("subscriptionId and enabled are required", 400, "BAD_REQUEST");
  }
  const subscriptions = tctx.project.autoIngest?.webexMeetingSeries ?? [];
  const index = subscriptions.findIndex((item) => item.id === subscriptionId);
  if (index < 0) {
    throw new ApiError("Meeting-series subscription not found", 404, "NOT_FOUND");
  }
  const updated = subscriptions.map((item, itemIndex) =>
    itemIndex === index ? { ...item, enabled: body.enabled as boolean } : item,
  );
  const projects = await getCollection<ProjectDocument>("projects");
  await projects.updateOne(
    { _id: mongoProjectId(tctx.projectId) },
    { $set: { "autoIngest.webexMeetingSeries": updated, updated_at: new Date() } },
  );
  auditTome({
    action: "tome.webex_meeting_series.update",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: { subscription_id: subscriptionId, enabled: body.enabled },
  });
  return successResponse({ subscriptions: updated });
});

export const DELETE = withErrorHandler(async (request: NextRequest, context: Ctx) => {
  const { slug } = await context.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  requireRegularProject(tctx.project);

  const subscriptionId = request.nextUrl.searchParams.get("subscriptionId")?.trim() ?? "";
  if (!subscriptionId) {
    throw new ApiError("subscriptionId is required", 400, "BAD_REQUEST");
  }
  const subscriptions = tctx.project.autoIngest?.webexMeetingSeries ?? [];
  if (!subscriptions.some((item) => item.id === subscriptionId)) {
    throw new ApiError("Meeting-series subscription not found", 404, "NOT_FOUND");
  }
  const updated = subscriptions.filter((item) => item.id !== subscriptionId);
  const projects = await getCollection<ProjectDocument>("projects");
  await projects.updateOne(
    { _id: mongoProjectId(tctx.projectId) },
    { $set: { "autoIngest.webexMeetingSeries": updated, updated_at: new Date() } },
  );
  auditTome({
    action: "tome.webex_meeting_series.delete",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: { subscription_id: subscriptionId },
  });
  return successResponse({ subscriptions: updated });
});
