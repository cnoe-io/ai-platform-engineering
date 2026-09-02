import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";

import { getCollection } from "@/lib/mongodb";
import type { ProjectDocument, WebexMeetingSeriesSubscription } from "@/types/projects";
import {
  TOME_COLLECTIONS,
  type WebexMeetingOccurrenceDocument,
} from "@/types/tome";

import { getTomeIngestRunsCollection } from "../mongo-collections";
import { enqueueRun, isIngestRunning } from "../ingest-runner";
import {
  backgroundWebexMeetingInvoker,
  discoverMeetingSeries,
  downloadMeetingTranscript,
  meetingSeriesMatches,
  resolveOccurrenceMeetingId,
  type WebexMeetingOccurrenceCandidate,
} from "../webex-meeting-series";
import {
  claimWebexMeetingOwnerCheck,
  scheduleWebexMeetingOwnerCheck,
} from "./cursor";

const COLLECTION = TOME_COLLECTIONS.WEBEX_MEETING_OCCURRENCES;
const REFRESH_INTERVAL_MS = Math.max(
  5 * 60_000,
  Number(process.env.TOME_WEBEX_SERIES_REFRESH_MS) || 24 * 60 * 60_000,
);
const POST_MEETING_DELAY_MS = 10 * 60_000;
const OWNER_CHECK_CLAIM_MS = 10 * 60_000;
const DISCOVERY_FAILURE_RETRY_MS = 15 * 60_000;
const LOOKBACK_MS = 48 * 60 * 60 * 1000;
const LOOKAHEAD_MS = 90 * 24 * 60 * 60 * 1000;
export function webexTranscriptMaxRetryPeriodMs(
  configured = process.env.TOME_WEBEX_TRANSCRIPT_MAX_RETRY_PERIOD_MS,
): number {
  const milliseconds = Number(configured);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? milliseconds
    : 2 * 60 * 60 * 1000;
}
const TRANSCRIPT_MAX_RETRY_PERIOD_MS = webexTranscriptMaxRetryPeriodMs();
const configuredTranscriptSettleMs = Number(process.env.TOME_WEBEX_TRANSCRIPT_SETTLE_MS);
const TRANSCRIPT_SETTLE_MS =
  Number.isFinite(configuredTranscriptSettleMs) && configuredTranscriptSettleMs >= 0
    ? configuredTranscriptSettleMs
    : 15 * 60_000;
const MAX_TRANSCRIPT_CHARS = Math.max(
  50_000,
  Number(process.env.TOME_WEBEX_TRANSCRIPT_MAX_CHARS) || 400_000,
);
const PROCESS_LIMIT = 10;

type BackgroundInvoke = Awaited<ReturnType<typeof backgroundWebexMeetingInvoker>>;
type SeriesDiscovery = Awaited<ReturnType<typeof discoverMeetingSeries>>;

function mongoProjectId(projectId: string): string {
  return (ObjectId.isValid(projectId) ? new ObjectId(projectId) : projectId) as unknown as string;
}

function occurrenceId(projectId: string, subscriptionId: string, occurrenceKey: string): string {
  return createHash("sha256")
    .update(`${projectId}\0${subscriptionId}\0${occurrenceKey}`)
    .digest("hex");
}

function retryAt(now: Date, attempts: number): Date {
  const delay = Math.min(2 * 60 * 60_000, 15 * 60_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delay);
}

function transcriptFingerprint(downloaded: {
  transcript: string;
  listedTranscriptIds: string[];
  listedCount: number;
}): string {
  return createHash("sha256")
    .update(String(downloaded.listedCount))
    .update("\0")
    .update(downloaded.listedTranscriptIds.join("\0"))
    .update("\0")
    .update(downloaded.transcript)
    .digest("hex");
}

async function updateSubscription(
  projectId: string,
  subscriptionId: string,
  fields: Partial<{
    lastOccurrenceAt: string;
    lastRunId: string;
    lastStatus: NonNullable<WebexMeetingSeriesSubscription["lastStatus"]>;
    lastError: string;
    title: string;
    siteUrl: string | null;
    lastCalendarCheckAt: string;
    nextOccurrenceStartAt: string | null;
    nextOccurrenceEndAt: string | null;
  }>,
): Promise<void> {
  const projects = await getCollection<ProjectDocument>("projects");
  const set: Record<string, unknown> = { updated_at: new Date() };
  const unset: Record<string, ""> = {};
  for (const [key, value] of Object.entries(fields)) {
    const path = `autoIngest.webexMeetingSeries.$[series].${key}`;
    if (value === null) unset[path] = "";
    else set[path] = value;
  }
  await projects.updateOne(
    { _id: mongoProjectId(projectId) },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { arrayFilters: [{ "series.id": subscriptionId }] },
  );
}

async function reconcileSubscriptionCalendar(
  project: ProjectDocument & { _id: string },
  subscription: WebexMeetingSeriesSubscription,
  now: Date,
  candidates: SeriesDiscovery,
): Promise<Date | null> {
  const series = candidates.find((candidate) => meetingSeriesMatches(candidate, subscription));
  if (!series) {
    await updateSubscription(project._id, subscription.id, {
      lastCalendarCheckAt: now.toISOString(),
      nextOccurrenceStartAt: null,
      nextOccurrenceEndAt: null,
      lastStatus: "failed",
      lastError: "The recurring meeting was not returned by Webex. It will be checked again.",
    });
    return null;
  }

  const next = series.nextOccurrence;
  await updateSubscription(project._id, subscription.id, {
    title: series.title,
    siteUrl: series.siteUrl || subscription.siteUrl || null,
    lastCalendarCheckAt: now.toISOString(),
    nextOccurrenceStartAt: next?.start ?? null,
    nextOccurrenceEndAt: next?.end ?? null,
    lastError: "",
  });

  const occurrences = await getCollection<WebexMeetingOccurrenceDocument>(COLLECTION);
  const subscribedAt = new Date(subscription.createdAt);
  for (const occurrence of series.occurrences) {
    const end = new Date(occurrence.end);
    if (
      occurrence.cancelled ||
      occurrence.state?.toLowerCase() === "missed" ||
      !Number.isFinite(end.getTime()) ||
      end > now
    ) {
      continue;
    }
    // Selecting a series is forward-looking. Do not silently backfill old
    // calendar history; a meeting already in progress when selected is okay.
    if (Number.isFinite(subscribedAt.getTime()) && end < subscribedAt) continue;
    const start = new Date(occurrence.start);
    if (!Number.isFinite(start.getTime())) continue;
    const id = occurrenceId(project._id, subscription.id, occurrence.occurrenceKey);
    await occurrences.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          _id: id,
          project_id: project._id,
          project_slug: project.slug,
          subscription_id: subscription.id,
          series_key: subscription.seriesKey,
          series_title: series.title,
          occurrence_key: occurrence.occurrenceKey,
          meeting_id: occurrence.meetingId,
          title: occurrence.title,
          start,
          end,
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
  }

  if (!next) return null;
  const nextEnd = new Date(next.end);
  if (!Number.isFinite(nextEnd.getTime())) return null;
  return new Date(nextEnd.getTime() + POST_MEETING_DELAY_MS);
}

async function reconcileRuns(
  project: ProjectDocument & { _id: string },
  subscriptions: WebexMeetingSeriesSubscription[],
): Promise<void> {
  const occurrences = await getCollection<WebexMeetingOccurrenceDocument>(COLLECTION);
  const queued = await occurrences.find({ project_id: project._id, status: "queued" }).toArray();
  if (!queued.length) return;
  const runs = await getTomeIngestRunsCollection();
  const bySubscription = new Map(subscriptions.map((item) => [item.id, item]));
  for (const occurrence of queued) {
    if (!occurrence.run_id) continue;
    const run = await runs.findOne({ _id: occurrence.run_id });
    if (!run || !["succeeded", "failed"].includes(run.status)) continue;
    const succeeded = run.status === "succeeded";
    const message = succeeded ? "" : run.error || "The Tome ingest run failed.";
    await occurrences.updateOne(
      { _id: occurrence._id, status: "queued" },
      {
        $set: {
          status: succeeded ? "ingested" : "failed",
          last_error: message,
          updated_at: new Date(),
        },
      },
    );
    if (bySubscription.has(occurrence.subscription_id)) {
      await updateSubscription(project._id, occurrence.subscription_id, {
        lastOccurrenceAt: occurrence.start.toISOString(),
        lastRunId: occurrence.run_id,
        lastStatus: succeeded ? "ingested" : "failed",
        lastError: message,
      });
    }
  }
}

async function markRetry(
  occurrence: WebexMeetingOccurrenceDocument,
  now: Date,
  error: string,
  terminalStatus: "failed" | "skipped" = "failed",
  terminalError = "No meeting transcript became available before the retry period ended.",
): Promise<void> {
  const occurrences = await getCollection<WebexMeetingOccurrenceDocument>(COLLECTION);
  const expired =
    now.getTime() - occurrence.end.getTime() >= TRANSCRIPT_MAX_RETRY_PERIOD_MS;
  const displayedError = expired ? terminalError : error;
  await occurrences.updateOne(
    { _id: occurrence._id, status: "processing" },
    {
      $set: {
        status: expired ? terminalStatus : "waiting_transcript",
        next_attempt_at: retryAt(now, occurrence.attempts + 1),
        last_error: displayedError,
        updated_at: now,
      },
      $inc: { attempts: 1 },
    },
  );
  await updateSubscription(occurrence.project_id, occurrence.subscription_id, {
    lastStatus: expired ? terminalStatus : "waiting_transcript",
    lastError: displayedError,
  });
}

async function processOccurrence(
  project: ProjectDocument & { _id: string },
  subscription: WebexMeetingSeriesSubscription,
  occurrence: WebexMeetingOccurrenceDocument,
  now: Date,
  loadInvoke: () => Promise<BackgroundInvoke>,
): Promise<boolean> {
  const occurrences = await getCollection<WebexMeetingOccurrenceDocument>(COLLECTION);
  const claimed = await occurrences.findOneAndUpdate(
    {
      _id: occurrence._id,
      status: { $in: ["pending", "waiting_transcript", "ready"] },
      next_attempt_at: { $lte: now },
    },
    { $set: { status: "processing", updated_at: now } },
    { returnDocument: "after" },
  );
  if (!claimed) return false;

  try {
    // Recover the narrow crash window between creating the run and updating
    // the occurrence row. The occurrence id remains the durable idempotency key.
    const runs = await getTomeIngestRunsCollection();
    const existingRun = await runs.findOne({ "dispatch.meetingOccurrenceId": claimed._id });
    if (existingRun) {
      const terminal = existingRun.status === "succeeded" || existingRun.status === "failed";
      const succeeded = existingRun.status === "succeeded";
      await occurrences.updateOne(
        { _id: claimed._id, status: "processing" },
        {
          $set: {
            status: terminal ? (succeeded ? "ingested" : "failed") : "queued",
            run_id: String(existingRun._id),
            last_error: existingRun.status === "failed" ? existingRun.error || "The Tome ingest run failed." : "",
            updated_at: now,
          },
        },
      );
      await updateSubscription(project._id, subscription.id, {
        lastOccurrenceAt: claimed.start.toISOString(),
        lastRunId: String(existingRun._id),
        lastStatus: terminal ? (succeeded ? "ingested" : "failed") : "queued",
        lastError: existingRun.status === "failed" ? existingRun.error || "The Tome ingest run failed." : "",
      });
      return !terminal;
    }

    const invoke = await loadInvoke();
    const candidate: WebexMeetingOccurrenceCandidate = {
      occurrenceKey: claimed.occurrence_key,
      meetingId: claimed.meeting_id,
      title: claimed.title,
      start: claimed.start.toISOString(),
      end: claimed.end.toISOString(),
      webLink: claimed.web_link,
      cancelled: false,
      source: claimed.source,
    };
    const meetingId = await resolveOccurrenceMeetingId(invoke, candidate);
    if (!meetingId) {
      await markRetry(
        claimed,
        now,
        "Waiting for meeting transcript.",
        "skipped",
      );
      return false;
    }
    const downloaded = await downloadMeetingTranscript(invoke, meetingId);
    if (!downloaded?.transcript) {
      await markRetry(claimed, now, "Waiting for meeting transcript.");
      return false;
    }
    if (downloaded.downloadedCount < downloaded.listedCount) {
      await markRetry(
        claimed,
        now,
        `Webex listed ${downloaded.listedCount} transcript segment(s), but only ${downloaded.downloadedCount} can be downloaded yet.`,
        "failed",
        "Some meeting transcript segments were still unavailable when the retry period ended.",
      );
      return false;
    }

    const fingerprint = transcriptFingerprint(downloaded);
    const unchanged = claimed.transcript_fingerprint === fingerprint;
    const previousObservedAt = claimed.transcript_observed_at
      ? new Date(claimed.transcript_observed_at)
      : null;
    const observedAt =
      unchanged && previousObservedAt && Number.isFinite(previousObservedAt.getTime())
        ? previousObservedAt
        : now;
    const stableForMs = now.getTime() - observedAt.getTime();
    const transcriptDeadline =
      claimed.end.getTime() + TRANSCRIPT_MAX_RETRY_PERIOD_MS;
    if (
      TRANSCRIPT_SETTLE_MS > 0 &&
      stableForMs < TRANSCRIPT_SETTLE_MS &&
      now.getTime() < transcriptDeadline
    ) {
      const nextAttemptAt = new Date(
        Math.min(observedAt.getTime() + TRANSCRIPT_SETTLE_MS, transcriptDeadline),
      );
      const message = `Found ${downloaded.downloadedCount} transcript segment(s); waiting for the transcript set to settle.`;
      await occurrences.updateOne(
        { _id: claimed._id, status: "processing" },
        {
          $set: {
            status: "waiting_transcript",
            meeting_id: meetingId,
            transcript_id: downloaded.transcriptId,
            transcript_ids: downloaded.transcriptIds,
            transcript_fingerprint: fingerprint,
            transcript_observed_at: observedAt,
            next_attempt_at: nextAttemptAt,
            last_error: message,
            updated_at: now,
          },
        },
      );
      await updateSubscription(project._id, subscription.id, {
        lastStatus: "waiting_transcript",
        lastError: message,
      });
      return false;
    }
    if (await isIngestRunning(project._id)) {
      await occurrences.updateOne(
        { _id: claimed._id, status: "processing" },
        {
          $set: {
            status: "ready",
            meeting_id: meetingId,
            transcript_id: downloaded.transcriptId,
            transcript_ids: downloaded.transcriptIds,
            transcript_fingerprint: fingerprint,
            transcript_observed_at: observedAt,
            next_attempt_at: new Date(now.getTime() + 5 * 60_000),
            updated_at: now,
          },
        },
      );
      return false;
    }

    const transcript = downloaded.transcript.slice(0, MAX_TRANSCRIPT_CHARS);
    const runId = await enqueueRun(project, {
      sub: subscription.credentialOwner.subject,
      email: subscription.credentialOwner.email,
      triggeredBy: "auto",
      dispatch: {
        endpoint: "/ingest",
        seed: null,
        mode: "quick",
        triggeredBy: "auto",
        meetingOccurrenceId: claimed._id,
        webexMeetings: [
          {
            id: meetingId,
            title: claimed.title,
            start: claimed.start.toISOString(),
            seriesKey: subscription.seriesKey,
            seriesSlug: subscription.seriesSlug,
            seriesTitle: subscription.title,
            occurrenceKey: claimed.occurrence_key,
            transcript,
          },
        ],
      },
    });
    await occurrences.updateOne(
      { _id: claimed._id, status: "processing" },
      {
        $set: {
          status: "queued",
          meeting_id: meetingId,
          transcript_id: downloaded.transcriptId,
          transcript_ids: downloaded.transcriptIds,
          transcript_fingerprint: fingerprint,
          transcript_observed_at: observedAt,
          run_id: runId,
          last_error:
            downloaded.transcript.length > transcript.length
              ? `Transcript was capped at ${MAX_TRANSCRIPT_CHARS} characters.`
              : "",
          updated_at: now,
        },
      },
    );
    await updateSubscription(project._id, subscription.id, {
      lastOccurrenceAt: claimed.start.toISOString(),
      lastRunId: runId,
      lastStatus: "queued",
      lastError: "",
    });
    console.log(`[WebexSeries] ${project.slug}/${subscription.title}: queued ${runId}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markRetry(claimed, now, message);
    return false;
  }
}

interface SubscriptionWorkItem {
  project: ProjectDocument & { _id: string };
  subscription: WebexMeetingSeriesSubscription;
}

interface OwnerSiteGroup {
  ownerSubject: string;
  siteUrl: string;
  items: SubscriptionWorkItem[];
}

function normalizedSiteUrl(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

function ownerSiteGroups(
  projects: Array<ProjectDocument & { _id: string }>,
): OwnerSiteGroup[] {
  const groups = new Map<string, OwnerSiteGroup>();
  for (const project of projects) {
    for (const subscription of project.autoIngest?.webexMeetingSeries ?? []) {
      if (!subscription.enabled) continue;
      const ownerSubject = subscription.credentialOwner.subject;
      const siteUrl = normalizedSiteUrl(subscription.siteUrl);
      const key = `${ownerSubject}\0${siteUrl.toLowerCase()}`;
      let group = groups.get(key);
      if (!group) {
        group = { ownerSubject, siteUrl, items: [] };
        groups.set(key, group);
      }
      group.items.push({ project, subscription });
    }
  }
  return [...groups.values()];
}

/** Reconcile user-level calendars and enqueue transcript-backed Tome ingests. */
export async function tickWebexMeetingSeriesScheduler(
  now: Date,
  projects: Array<ProjectDocument & { _id: string }>,
): Promise<void> {
  const occurrences = await getCollection<WebexMeetingOccurrenceDocument>(COLLECTION);
  await occurrences.updateMany(
    {
      status: "processing",
      updated_at: { $lt: new Date(now.getTime() - 10 * 60_000) },
    },
    { $set: { status: "waiting_transcript", next_attempt_at: now, updated_at: now } },
  );

  // A user's OAuth token is shared across sites, while each site has its own
  // User Hub calendar. Cache the token once and reconcile every subscribed
  // series in a site from one four-tool discovery sweep.
  const invokers = new Map<string, Promise<BackgroundInvoke>>();
  const invokeFor = (subscription: WebexMeetingSeriesSubscription): Promise<BackgroundInvoke> => {
    const key = subscription.credentialOwner.subject;
    let pending = invokers.get(key);
    if (!pending) {
      pending = backgroundWebexMeetingInvoker(key);
      invokers.set(key, pending);
    }
    return pending;
  };

  for (const group of ownerSiteGroups(projects)) {
    let claimed = false;
    try {
      claimed = await claimWebexMeetingOwnerCheck(
        group.ownerSubject,
        group.siteUrl,
        now,
        new Date(now.getTime() + OWNER_CHECK_CLAIM_MS),
      );
    } catch (error) {
      console.error(
        `[WebexSeries] ${group.ownerSubject}: failed to claim calendar check: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!claimed) continue;

    let nextCheckAt = new Date(now.getTime() + REFRESH_INTERVAL_MS);
    try {
      const representative = group.items[0]?.subscription;
      if (!representative) continue;
      const invoke = await invokeFor(representative);
      const candidates = await discoverMeetingSeries(invoke, {
        from: new Date(now.getTime() - LOOKBACK_MS),
        to: new Date(now.getTime() + LOOKAHEAD_MS),
        siteUrl: group.siteUrl || undefined,
        now,
      });
      for (const item of group.items) {
        try {
          const eventCheckAt = await reconcileSubscriptionCalendar(
            item.project,
            item.subscription,
            now,
            candidates,
          );
          if (eventCheckAt && eventCheckAt > now && eventCheckAt < nextCheckAt) {
            nextCheckAt = eventCheckAt;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            `[WebexSeries] ${item.project.slug}/${item.subscription.title}: reconciliation failed: ${message}`,
          );
          await updateSubscription(item.project._id, item.subscription.id, {
            lastCalendarCheckAt: now.toISOString(),
            lastStatus: "failed",
            lastError: message,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[WebexSeries] ${group.ownerSubject}: discovery failed: ${message}`);
      nextCheckAt = new Date(now.getTime() + DISCOVERY_FAILURE_RETRY_MS);
      for (const item of group.items) {
        await updateSubscription(item.project._id, item.subscription.id, {
          lastCalendarCheckAt: now.toISOString(),
          lastStatus: "failed",
          lastError: message,
        });
      }
    }

    try {
      await scheduleWebexMeetingOwnerCheck(
        group.ownerSubject,
        group.siteUrl,
        now,
        nextCheckAt,
      );
    } catch (error) {
      console.error(
        `[WebexSeries] ${group.ownerSubject}: failed to schedule next calendar check: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  for (const project of projects) {
    const subscriptions = (project.autoIngest?.webexMeetingSeries ?? []).filter(
      (subscription) => subscription.enabled,
    );
    if (!subscriptions.length) continue;
    await reconcileRuns(project, subscriptions);

    const subscriptionsById = new Map(subscriptions.map((item) => [item.id, item]));
    const due = await occurrences
      .find({
        project_id: project._id,
        subscription_id: { $in: subscriptions.map((item) => item.id) },
        status: { $in: ["pending", "waiting_transcript", "ready"] },
        next_attempt_at: { $lte: now },
      })
      .sort({ start: 1 })
      .limit(PROCESS_LIMIT)
      .toArray();
    for (const occurrence of due) {
      const subscription = subscriptionsById.get(occurrence.subscription_id);
      if (!subscription) continue;
      // Preserve project serialization. At most one new run is enqueued per tick.
      if (await processOccurrence(
        project,
        subscription,
        occurrence,
        now,
        () => invokeFor(subscription),
      )) {
        break;
      }
    }
  }
}
