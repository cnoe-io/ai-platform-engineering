import { createHash } from "node:crypto";

import { ApiError } from "@/lib/api-error";
import { getCollection } from "@/lib/mongodb";
import type { ProjectDocument, WebexMeetingSeriesSubscription } from "@/types/projects";
import {
  TOME_COLLECTIONS,
  type WebexMeetingOccurrenceDocument,
} from "@/types/tome";

import {
  backgroundWebexMeetingInvoker,
  discoverMeetingSeries,
  meetingSeriesMatches,
  type WebexMeetingOccurrenceCandidate,
} from "../webex-meeting-series";

const DAY_MS = 24 * 60 * 60_000;
const CROSS_SOURCE_TOLERANCE_MS = 30 * 60_000;

export interface WebexMeetingSeriesBackfillItem {
  occurrenceKey: string;
  meetingId?: string;
  title: string;
  start: string;
  end: string;
  webLink?: string;
  source: "meetings_api" | "userhub_calendar";
}

export interface WebexMeetingSeriesBackfillPreview {
  lookbackDays: number;
  from: string;
  to: string;
  foundCount: number;
  trackedCount: number;
  missing: WebexMeetingSeriesBackfillItem[];
}

export function webexMeetingSeriesBackfillLookbackDays(
  configured = process.env.TOME_WEBEX_RETRO_SYNC_LOOKBACK_DAYS,
): number {
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.min(365, Math.max(1, Math.floor(parsed)));
}

export function webexMeetingOccurrenceId(
  projectId: string,
  subscriptionId: string,
  occurrenceKey: string,
): string {
  return createHash("sha256")
    .update(`${projectId}\0${subscriptionId}\0${occurrenceKey}`)
    .digest("hex");
}

function isEndedOccurrence(
  occurrence: WebexMeetingOccurrenceCandidate,
  from: Date,
  now: Date,
): boolean {
  const start = Date.parse(occurrence.start);
  const end = Date.parse(occurrence.end);
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end >= from.getTime() &&
    end <= now.getTime() &&
    !occurrence.cancelled &&
    occurrence.state?.toLowerCase() !== "missed"
  );
}

function alreadyTracked(
  projectId: string,
  subscriptionId: string,
  candidate: WebexMeetingOccurrenceCandidate,
  tracked: WebexMeetingOccurrenceDocument[],
): boolean {
  const deterministicId = webexMeetingOccurrenceId(
    projectId,
    subscriptionId,
    candidate.occurrenceKey,
  );
  return tracked.some((item) => {
    if (item._id === deterministicId || item.occurrence_key === candidate.occurrenceKey) return true;
    if (candidate.meetingId && item.meeting_id === candidate.meetingId) return true;
    if (item.source === candidate.source) return false;
    if (item.title.trim().toLowerCase() !== candidate.title.trim().toLowerCase()) return false;
    const candidateStart = Date.parse(candidate.start);
    return (
      Number.isFinite(candidateStart) &&
      Math.abs(item.start.getTime() - candidateStart) <= CROSS_SOURCE_TOLERANCE_MS
    );
  });
}

function serializeOccurrence(
  occurrence: WebexMeetingOccurrenceCandidate,
): WebexMeetingSeriesBackfillItem {
  return {
    occurrenceKey: occurrence.occurrenceKey,
    ...(occurrence.meetingId ? { meetingId: occurrence.meetingId } : {}),
    title: occurrence.title,
    start: occurrence.start,
    end: occurrence.end,
    ...(occurrence.webLink ? { webLink: occurrence.webLink } : {}),
    source: occurrence.source,
  };
}

/**
 * Perform a fresh, owner-authenticated lookup and return ended occurrences
 * that have no durable scheduler row yet. This function never mutates state.
 */
export async function previewWebexMeetingSeriesBackfill(
  project: ProjectDocument & { _id: string },
  subscription: WebexMeetingSeriesSubscription,
  now = new Date(),
  lookbackDays = webexMeetingSeriesBackfillLookbackDays(),
): Promise<WebexMeetingSeriesBackfillPreview> {
  const from = new Date(now.getTime() - lookbackDays * DAY_MS);
  const invoke = await backgroundWebexMeetingInvoker(subscription.credentialOwner.subject);
  const candidates = await discoverMeetingSeries(invoke, {
    from,
    to: now,
    siteUrl: subscription.siteUrl,
    now,
  });
  const series = candidates.find((candidate) => meetingSeriesMatches(candidate, subscription));
  if (!series) {
    throw new ApiError(
      "That recurring meeting was not returned by Webex for the selected time range.",
      404,
      "WEBEX_MEETING_SERIES_NOT_FOUND",
    );
  }

  const ended = series.occurrences.filter((occurrence) => isEndedOccurrence(occurrence, from, now));
  const collection = await getCollection<WebexMeetingOccurrenceDocument>(
    TOME_COLLECTIONS.WEBEX_MEETING_OCCURRENCES,
  );
  const tracked = await collection
    .find({ project_id: project._id, subscription_id: subscription.id })
    .toArray();
  const missing = ended
    .filter(
      (occurrence) =>
        !alreadyTracked(project._id, subscription.id, occurrence, tracked),
    )
    .sort((left, right) => right.start.localeCompare(left.start))
    .map(serializeOccurrence);

  return {
    lookbackDays,
    from: from.toISOString(),
    to: now.toISOString(),
    foundCount: ended.length,
    trackedCount: ended.length - missing.length,
    missing,
  };
}

/** Revalidate a preview and enqueue only the explicitly selected rows. */
export async function queueWebexMeetingSeriesBackfill(
  project: ProjectDocument & { _id: string },
  subscription: WebexMeetingSeriesSubscription,
  occurrenceKeys: string[],
  now = new Date(),
): Promise<{ queuedCount: number; skippedCount: number }> {
  const selected = new Set(occurrenceKeys);
  const preview = await previewWebexMeetingSeriesBackfill(project, subscription, now);
  const requested = preview.missing.filter((occurrence) => selected.has(occurrence.occurrenceKey));
  const collection = await getCollection<WebexMeetingOccurrenceDocument>(
    TOME_COLLECTIONS.WEBEX_MEETING_OCCURRENCES,
  );
  let queuedCount = 0;

  for (const occurrence of requested) {
    const id = webexMeetingOccurrenceId(project._id, subscription.id, occurrence.occurrenceKey);
    const result = await collection.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          _id: id,
          project_id: project._id,
          project_slug: project.slug,
          subscription_id: subscription.id,
          series_key: subscription.seriesKey,
          series_title: subscription.title,
          occurrence_key: occurrence.occurrenceKey,
          meeting_id: occurrence.meetingId,
          title: occurrence.title,
          start: new Date(occurrence.start),
          end: new Date(occurrence.end),
          web_link: occurrence.webLink,
          source: occurrence.source,
          status: "pending",
          attempts: 0,
          next_attempt_at: now,
          created_at: now,
          updated_at: now,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount > 0) queuedCount += 1;
  }

  return {
    queuedCount,
    skippedCount: occurrenceKeys.length - queuedCount,
  };
}
