"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileClock,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WebexMeetingSeriesSubscription } from "@/types/projects";
import type { WebexMeetingOccurrenceSummary } from "@/types/tome";
import { cn } from "@/lib/utils";

interface Candidate {
  seriesKey: string;
  title: string;
  hostEmail?: string;
  sources: string[];
  canAutoIngest: boolean;
  unavailableReason?: string;
  nextOccurrence?: { start: string };
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: { message?: string } | string;
  code?: string;
  message?: string;
}

interface BackfillItem {
  occurrenceKey: string;
  title: string;
  start: string;
  end: string;
}

interface BackfillPreview {
  lookbackDays: number;
  foundCount: number;
  trackedCount: number;
  missing: BackfillItem[];
}

const WEBEX_CONNECTION_REQUIRED = "WEBEX_MEETINGS_CONNECTION_REQUIRED";
const LEGACY_TRANSCRIPT_WAIT_MESSAGES = new Set([
  "Webex has not exposed an official meeting occurrence yet.",
  "The meeting ended, but its transcript is not available yet.",
]);

function meetingStatusMessage(message: string): string {
  return LEGACY_TRANSCRIPT_WAIT_MESSAGES.has(message)
    ? "Waiting for meeting transcript."
    : message;
}

const SCHEDULED_CHECK_STATUSES = new Set(["pending", "processing", "waiting_transcript", "ready"]);

function nextCheckSuffix(status: string | undefined, nextAttemptAt: string | undefined): string {
  if (!status || !SCHEDULED_CHECK_STATUSES.has(status) || !nextAttemptAt) return "";
  const timestamp = new Date(nextAttemptAt);
  if (!Number.isFinite(timestamp.getTime())) return "";
  return ` (Next check: ${timestamp.toLocaleString()})`;
}

function subscriptionNextAttempt(
  subscription: WebexMeetingSeriesSubscription,
  occurrences: WebexMeetingOccurrenceSummary[],
): string | undefined {
  if (!subscription.lastStatus || !SCHEDULED_CHECK_STATUSES.has(subscription.lastStatus)) {
    return undefined;
  }
  return occurrences.find(
    (occurrence) =>
      occurrence.status === subscription.lastStatus &&
      occurrence.lastError === subscription.lastError,
  )?.nextAttemptAt;
}

function occurrenceStatus(occurrence: WebexMeetingOccurrenceSummary): {
  label: string;
  className: string;
} {
  const status = occurrence.runStatus ?? occurrence.status;
  if (status === "succeeded" || status === "ingested") {
    return {
      label: "Ingested",
      className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    };
  }
  if (status === "failed") {
    return {
      label: "Failed",
      className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    };
  }
  if (status === "awaiting_review") {
    return {
      label: "Awaiting review",
      className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    };
  }
  if (status === "running" || status === "queued" || status === "ready") {
    return {
      label: status === "running" ? "Ingesting" : status === "queued" ? "Queued" : "Ready",
      className: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
    };
  }
  if (status === "skipped") {
    return { label: "Skipped", className: "bg-muted text-muted-foreground" };
  }
  return {
    label: status === "processing" ? "Checking" : "Waiting",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  };
}

function apiError(body: ApiEnvelope<unknown>, fallback: string): string {
  if (typeof body.error === "string") return body.error;
  return body.error?.message || body.message || fallback;
}

export function WebexMeetingSeriesSettings({
  slug,
  canEdit,
}: {
  slug: string;
  canEdit: boolean;
}) {
  const endpoint = `/api/tome/projects/${encodeURIComponent(slug)}/webex-meeting-series`;
  const [subscriptions, setSubscriptions] = useState<WebexMeetingSeriesSubscription[]>([]);
  const [occurrences, setOccurrences] = useState<WebexMeetingOccurrenceSummary[]>([]);
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [mutating, setMutating] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [accessWarningCandidate, setAccessWarningCandidate] = useState<Candidate | null>(null);
  const [allowNonHostSeries, setAllowNonHostSeries] = useState(true);
  const [syncSubscription, setSyncSubscription] =
    useState<WebexMeetingSeriesSubscription | null>(null);
  const [syncPreview, setSyncPreview] = useState<BackfillPreview | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [selectedBackfill, setSelectedBackfill] = useState<Set<string>>(new Set());
  const [syncResult, setSyncResult] = useState("");
  const [retryingOccurrence, setRetryingOccurrence] = useState<string | null>(null);

  const loadSubscriptions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as ApiEnvelope<{
        subscriptions?: WebexMeetingSeriesSubscription[];
        occurrences?: WebexMeetingOccurrenceSummary[];
      }>;
      if (!response.ok) throw new Error(apiError(body, "Could not load meeting series."));
      setSubscriptions(body.data?.subscriptions ?? []);
      setOccurrences(body.data?.occurrences ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load meeting series.");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    void loadSubscriptions();
  }, [loadSubscriptions]);

  const discover = async () => {
    setDialogOpen(true);
    setDiscovering(true);
    setError("");
    setErrorCode("");
    setSearchQuery("");
    try {
      const response = await fetch(`${endpoint}?discover=1`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as ApiEnvelope<{
        subscriptions?: WebexMeetingSeriesSubscription[];
        candidates?: Candidate[];
        allowNonHostSeries?: boolean;
      }>;
      if (!response.ok) {
        setErrorCode(body.code ?? "");
        throw new Error(apiError(body, "Could not find recurring meetings."));
      }
      setSubscriptions(body.data?.subscriptions ?? []);
      setCandidates(body.data?.candidates ?? []);
      setAllowNonHostSeries(body.data?.allowNonHostSeries !== false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not find recurring meetings.");
    } finally {
      setDiscovering(false);
    }
  };

  const add = async (candidate: Candidate) => {
    setMutating(candidate.seriesKey);
    setError("");
    setErrorCode("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesKey: candidate.seriesKey }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiEnvelope<{
        subscription?: WebexMeetingSeriesSubscription;
      }>;
      if (!response.ok || !body.data?.subscription) {
        setErrorCode(body.code ?? "");
        throw new Error(apiError(body, "Could not add meeting series."));
      }
      setSubscriptions((current) => {
        const next = current.filter((item) => item.id !== body.data?.subscription?.id);
        return [...next, body.data!.subscription!];
      });
      setDialogOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add meeting series.");
    } finally {
      setMutating(null);
    }
  };

  const toggle = async (subscription: WebexMeetingSeriesSubscription, enabled: boolean) => {
    setMutating(subscription.id);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: subscription.id, enabled }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiEnvelope<{
        subscriptions?: WebexMeetingSeriesSubscription[];
      }>;
      if (!response.ok) throw new Error(apiError(body, "Could not update meeting series."));
      setSubscriptions(body.data?.subscriptions ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update meeting series.");
    } finally {
      setMutating(null);
    }
  };

  const remove = async (subscription: WebexMeetingSeriesSubscription) => {
    if (!window.confirm(`Stop auto-ingesting “${subscription.title}”?`)) return;
    setMutating(subscription.id);
    setError("");
    try {
      const response = await fetch(
        `${endpoint}?subscriptionId=${encodeURIComponent(subscription.id)}`,
        { method: "DELETE" },
      );
      const body = (await response.json().catch(() => ({}))) as ApiEnvelope<{
        subscriptions?: WebexMeetingSeriesSubscription[];
      }>;
      if (!response.ok) throw new Error(apiError(body, "Could not remove meeting series."));
      setSubscriptions(body.data?.subscriptions ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove meeting series.");
    } finally {
      setMutating(null);
    }
  };

  const syncNow = async (subscription: WebexMeetingSeriesSubscription) => {
    setSyncSubscription(subscription);
    setSyncPreview(null);
    setSelectedBackfill(new Set());
    setSyncResult("");
    setSyncError("");
    setSyncLoading(true);
    try {
      const response = await fetch(
        `${endpoint}/sync?subscriptionId=${encodeURIComponent(subscription.id)}`,
        { cache: "no-store" },
      );
      const body = (await response.json().catch(() => ({}))) as ApiEnvelope<BackfillPreview>;
      if (!response.ok || !body.data) {
        throw new Error(apiError(body, "Could not check past meeting occurrences."));
      }
      setSyncPreview(body.data);
    } catch (cause) {
      setSyncError(
        cause instanceof Error ? cause.message : "Could not check past meeting occurrences.",
      );
    } finally {
      setSyncLoading(false);
    }
  };

  const toggleBackfill = (occurrenceKey: string, checked: boolean) => {
    setSelectedBackfill((current) => {
      const next = new Set(current);
      if (checked) next.add(occurrenceKey);
      else next.delete(occurrenceKey);
      return next;
    });
  };

  const queueBackfill = async () => {
    if (!syncSubscription || selectedBackfill.size === 0) return;
    setSyncLoading(true);
    setSyncError("");
    setSyncResult("");
    try {
      const response = await fetch(`${endpoint}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptionId: syncSubscription.id,
          occurrenceKeys: [...selectedBackfill],
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiEnvelope<{
        queuedCount: number;
        skippedCount: number;
      }>;
      if (!response.ok || !body.data) {
        throw new Error(apiError(body, "Could not queue past meeting occurrences."));
      }
      const queued = body.data.queuedCount;
      setSyncResult(
        queued > 0
          ? `${queued} meeting${queued === 1 ? "" : "s"} queued for transcript ingestion.`
          : "Those meetings were already caught up.",
      );
      setSyncPreview((current) =>
        current
          ? {
              ...current,
              trackedCount: current.trackedCount + queued,
              missing: current.missing.filter(
                (item) => !selectedBackfill.has(item.occurrenceKey),
              ),
            }
          : current,
      );
      setSelectedBackfill(new Set());
      await loadSubscriptions();
    } catch (cause) {
      setSyncError(
        cause instanceof Error ? cause.message : "Could not queue past meeting occurrences.",
      );
    } finally {
      setSyncLoading(false);
    }
  };

  const retryOccurrence = async (occurrence: WebexMeetingOccurrenceSummary) => {
    setRetryingOccurrence(occurrence.id);
    setError("");
    try {
      const response = await fetch(`${endpoint}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occurrenceId: occurrence.id }),
      });
      const body = (await response.json().catch(() => ({}))) as ApiEnvelope<{
        runId: string;
        status: "queued";
      }>;
      if (!response.ok || !body.data?.runId) {
        throw new Error(apiError(body, "Could not retry the failed meeting ingest."));
      }
      await loadSubscriptions();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not retry the failed meeting ingest.",
      );
    } finally {
      setRetryingOccurrence(null);
    }
  };

  const available = useMemo(
    () => candidates.filter((candidate) => !subscriptions.some((item) => item.seriesKey === candidate.seriesKey)),
    [candidates, subscriptions],
  );
  const visibleAvailable = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return available;
    return available.filter((candidate) =>
      [candidate.title, candidate.hostEmail].some((value) => value?.toLowerCase().includes(query)),
    );
  }, [available, searchQuery]);
  const occurrencesBySubscription = useMemo(() => {
    const grouped = new Map<string, WebexMeetingOccurrenceSummary[]>();
    for (const occurrence of occurrences) {
      const current = grouped.get(occurrence.subscriptionId) ?? [];
      current.push(occurrence);
      grouped.set(occurrence.subscriptionId, current);
    }
    return grouped;
  }, [occurrences]);
  const reviewBlockersBySubscription = useMemo(() => {
    const blockers = new Map<string, WebexMeetingOccurrenceSummary>();
    for (const occurrence of occurrences) {
      if (
        occurrence.status === "ready" &&
        occurrence.blockedByRunStatus === "awaiting_review" &&
        !blockers.has(occurrence.subscriptionId)
      ) {
        blockers.set(occurrence.subscriptionId, occurrence);
      }
    }
    return blockers;
  }, [occurrences]);

  const toggleHistory = (subscriptionId: string) => {
    setExpandedSeries((current) => {
      const next = new Set(current);
      if (next.has(subscriptionId)) next.delete(subscriptionId);
      else next.add(subscriptionId);
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-border/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="h-4 w-4" /> Recurring Webex meetings
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ingest each occurrence after its transcript becomes available. This follows the
            meeting calendar, independently of the schedule above.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={!canEdit} onClick={() => void discover()}>
          <Plus className="mr-1.5 h-4 w-4" /> Add series
        </Button>
      </div>

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading meeting series…
        </p>
      ) : subscriptions.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No recurring meetings selected.</p>
      ) : (
        <div className="mt-4 divide-y rounded-lg border border-border/60">
          {subscriptions.map((subscription) => (
            <div key={subscription.id}>
              <div className="flex items-center gap-3 px-3 py-3">
                <input
                  type="checkbox"
                  aria-label={`Auto-ingest ${subscription.title}`}
                  checked={subscription.enabled}
                  disabled={!canEdit || mutating === subscription.id}
                  onChange={(event) => void toggle(subscription, event.target.checked)}
                />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${expandedSeries.has(subscription.id) ? "Collapse" : "Expand"} occurrence history for ${subscription.title}`}
                  aria-expanded={expandedSeries.has(subscription.id)}
                  aria-controls={`webex-series-history-${subscription.id}`}
                  onClick={() => toggleHistory(subscription.id)}
                >
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      expandedSeries.has(subscription.id) && "rotate-90",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{subscription.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Runs as {subscription.credentialOwner.name || subscription.credentialOwner.email}
                      {subscription.lastOccurrenceAt
                        ? ` · Last occurrence ${new Date(subscription.lastOccurrenceAt).toLocaleString()}`
                        : ""}
                      {subscription.nextOccurrenceStartAt
                        ? ` · Next ${new Date(subscription.nextOccurrenceStartAt).toLocaleString()}`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {occurrencesBySubscription.get(subscription.id)?.length ?? 0} past occurrence
                      {(occurrencesBySubscription.get(subscription.id)?.length ?? 0) === 1 ? "" : "s"}
                    </p>
                    {subscription.lastError &&
                    !reviewBlockersBySubscription.has(subscription.id) ? (
                      <p
                        className={cn(
                          "mt-1 text-xs",
                          subscription.lastStatus === "failed"
                            ? "text-destructive"
                            : subscription.lastStatus === "skipped"
                              ? "text-muted-foreground"
                              : "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {meetingStatusMessage(subscription.lastError)}
                        {nextCheckSuffix(
                          subscription.lastStatus,
                          subscriptionNextAttempt(
                            subscription,
                            occurrencesBySubscription.get(subscription.id) ?? [],
                          ),
                        )}
                      </p>
                    ) : null}
                  </div>
                </button>
                {mutating === subscription.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      disabled={!canEdit}
                      onClick={() => void syncNow(subscription)}
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Sync now
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${subscription.title}`}
                      disabled={!canEdit}
                      onClick={() => void remove(subscription)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              {reviewBlockersBySubscription.has(subscription.id) && (
                <div className="mx-3 mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <p className="font-medium">Warning: needs attention</p>
                    <p>
                      Transcript ready; another ingest draft needs review before this meeting can
                      continue.
                      {nextCheckSuffix(
                        "ready",
                        reviewBlockersBySubscription.get(subscription.id)?.nextAttemptAt,
                      )}
                    </p>
                    {reviewBlockersBySubscription.get(subscription.id)?.blockedByRunId && (
                      <Link
                        className="font-medium underline underline-offset-2"
                        href={`/projects/${encodeURIComponent(slug)}/tome/ingest/${encodeURIComponent(reviewBlockersBySubscription.get(subscription.id)!.blockedByRunId!)}/review`}
                      >
                        Review blocking ingest
                      </Link>
                    )}
                  </div>
                </div>
              )}
              {expandedSeries.has(subscription.id) && (
                <div
                  id={`webex-series-history-${subscription.id}`}
                  className="border-t bg-muted/20 px-3 py-3"
                >
                  {(occurrencesBySubscription.get(subscription.id)?.length ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">No past occurrences tracked yet.</p>
                  ) : (
                    <ul className="divide-y rounded-md border bg-background">
                      {occurrencesBySubscription.get(subscription.id)!.map((occurrence) => {
                        const ingest = occurrenceStatus(occurrence);
                        const terminalWithoutTranscript =
                          occurrence.status === "failed" || occurrence.status === "skipped";
                        return (
                          <li
                            key={occurrence.id}
                            className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium">{occurrence.title}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {new Date(occurrence.start).toLocaleString()}
                              </p>
                              {occurrence.lastError && (
                                <p
                                  className={cn(
                                    "mt-1 text-[11px]",
                                    occurrence.status === "failed"
                                      ? "text-destructive"
                                      : occurrence.status === "skipped"
                                        ? "text-muted-foreground"
                                        : "text-amber-600 dark:text-amber-400",
                                  )}
                                >
                                  {meetingStatusMessage(occurrence.lastError)}
                                  {nextCheckSuffix(occurrence.status, occurrence.nextAttemptAt)}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                  occurrence.transcriptFound
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                                    : "bg-muted text-muted-foreground",
                                )}
                              >
                                {occurrence.transcriptFound
                                  ? `${occurrence.transcriptCount} transcript${occurrence.transcriptCount === 1 ? "" : "s"} found`
                                  : terminalWithoutTranscript
                                    ? "No transcript found"
                                    : "Transcript pending"}
                              </span>
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                  ingest.className,
                                )}
                              >
                                {ingest.label}
                              </span>
                            </div>
                            {occurrence.runId && (
                              <div className="flex shrink-0 items-center gap-1.5">
                                {occurrence.runStatus === "failed" && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    disabled={!canEdit || retryingOccurrence === occurrence.id}
                                    onClick={() => void retryOccurrence(occurrence)}
                                  >
                                    <RefreshCw
                                      className={cn(
                                        "h-3.5 w-3.5",
                                        retryingOccurrence === occurrence.id && "animate-spin",
                                      )}
                                    />
                                    Retry
                                  </Button>
                                )}
                                {(occurrence.runStatus === "awaiting_review" ||
                                  (occurrence.runStatus === "succeeded" && occurrence.reportId)) && (
                                  <Button asChild type="button" size="sm" variant="outline" className="h-7 px-2 text-xs">
                                    <Link
                                      href={`/projects/${encodeURIComponent(slug)}/tome/ingest/${encodeURIComponent(occurrence.runId)}/review`}
                                    >
                                      <FileText className="h-3.5 w-3.5" />
                                      {occurrence.runStatus === "awaiting_review" ? "Review" : "View changes"}
                                    </Link>
                                  </Button>
                                )}
                                <Button asChild type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs">
                                  <Link
                                    href={`/projects/${encodeURIComponent(slug)}/tome/ingest/${encodeURIComponent(occurrence.runId)}`}
                                  >
                                    <FileClock className="h-3.5 w-3.5" /> Logs
                                    {occurrence.logLines > 0 ? ` (${occurrence.logLines})` : ""}
                                  </Link>
                                </Button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && !dialogOpen && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add recurring Webex meeting</DialogTitle>
            <DialogDescription>
              Results combine Webex Meetings and User Hub calendar discovery. The selected series
              will use your Webex (Meetings) connection. Series are not date-limited; occurrences
              are checked from 48 hours ago through the next 90 days.
            </DialogDescription>
          </DialogHeader>
          {discovering ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Finding recurring meetings…
            </p>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p>{error}</p>
              {errorCode === WEBEX_CONNECTION_REQUIRED && (
                <Link href="/credentials#connections" className="mt-2 inline-block font-medium text-primary underline">
                  Connect Webex (Meetings)
                </Link>
              )}
            </div>
          ) : available.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">No unselected recurring meetings were found.</p>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by meeting title or host"
                  className="pl-9"
                  autoFocus
                />
              </div>
              {visibleAvailable.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No meetings match “{searchQuery.trim()}”.
                </p>
              ) : (
                <div className="divide-y rounded-lg border border-border/60">
                  {visibleAvailable.map((candidate) => (
                    <div
                      key={candidate.seriesKey}
                      className={cn(
                        "flex items-center gap-3 px-3 py-3",
                        !candidate.canAutoIngest &&
                          "bg-amber-50/70 dark:bg-amber-950/20",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          {candidate.title}
                          {!candidate.canAutoIngest && (
                            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                              {allowNonHostSeries ? "Not host" : "Disabled"}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {candidate.nextOccurrence
                            ? `Next: ${new Date(candidate.nextOccurrence.start).toLocaleString()}`
                            : "No upcoming occurrence in the next 90 days"}
                          {candidate.hostEmail ? ` · Host: ${candidate.hostEmail}` : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={candidate.canAutoIngest ? "default" : "outline"}
                        className={cn(
                          !candidate.canAutoIngest &&
                            "border-amber-500 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-950/50",
                        )}
                        disabled={
                          mutating === candidate.seriesKey ||
                          (!candidate.canAutoIngest && !allowNonHostSeries)
                        }
                        onClick={() => {
                          if (candidate.canAutoIngest) void add(candidate);
                          else if (allowNonHostSeries) setAccessWarningCandidate(candidate);
                        }}
                      >
                        {mutating === candidate.seriesKey && (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        )}
                        Add
                      </Button>
                      {!candidate.canAutoIngest && !allowNonHostSeries && (
                        <span className="sr-only">
                          Non-hosted meeting series are disabled by your administrator.
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(syncSubscription)}
        onOpenChange={(open) => {
          if (!open && !syncLoading) setSyncSubscription(null);
        }}
      >
        <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Sync past Webex meetings</DialogTitle>
            <DialogDescription>
              Check “{syncSubscription?.title}” for ended occurrences that Tome has not tracked.
              This is a fresh lookup using {syncSubscription?.credentialOwner.name || syncSubscription?.credentialOwner.email}&apos;s
              Webex (Meetings) connection.
            </DialogDescription>
          </DialogHeader>

          {syncLoading && !syncPreview ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking past meetings…
            </p>
          ) : syncError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {syncError}
            </div>
          ) : syncPreview ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Checked the past {syncPreview.lookbackDays} days. Webex returned {syncPreview.foundCount} ended
                meeting{syncPreview.foundCount === 1 ? "" : "s"}; {syncPreview.trackedCount} {syncPreview.trackedCount === 1 ? "is" : "are"} already tracked.
              </p>

              {syncResult && (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {syncResult}
                </div>
              )}

              {syncPreview.missing.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm font-medium">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" /> All caught up
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">
                      Found {syncPreview.missing.length} missing meeting{syncPreview.missing.length === 1 ? "" : "s"}
                    </p>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        aria-label="Select all missing meetings"
                        checked={selectedBackfill.size === syncPreview.missing.length}
                        onChange={(event) =>
                          setSelectedBackfill(
                            event.target.checked
                              ? new Set(syncPreview.missing.map((item) => item.occurrenceKey))
                              : new Set(),
                          )
                        }
                      />
                      Select all
                    </label>
                  </div>
                  <ul className="divide-y rounded-lg border">
                    {syncPreview.missing.map((meeting) => (
                      <li key={meeting.occurrenceKey} className="flex items-center gap-3 px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${meeting.title} on ${new Date(meeting.start).toLocaleString()}`}
                          checked={selectedBackfill.has(meeting.occurrenceKey)}
                          onChange={(event) =>
                            toggleBackfill(meeting.occurrenceKey, event.target.checked)
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{meeting.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(meeting.start).toLocaleString()} – {new Date(meeting.end).toLocaleTimeString()}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {!syncSubscription?.enabled && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Enable this series before queuing historical meetings.
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={syncLoading}
                      onClick={() => setSyncSubscription(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      disabled={
                        syncLoading || selectedBackfill.size === 0 || !syncSubscription?.enabled
                      }
                      onClick={() => void queueBackfill()}
                    >
                      {syncLoading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                      Ingest selected ({selectedBackfill.size})
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(accessWarningCandidate)}
        onOpenChange={(open) => {
          if (!open) setAccessWarningCandidate(null);
        }}
      >
        <DialogContent className="border-amber-400 sm:max-w-lg dark:border-amber-700">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
              <TriangleAlert className="h-5 w-5 text-amber-600" /> Recording access required
            </DialogTitle>
            <DialogDescription>
              You are not the host of “{accessWarningCandidate?.title}”.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            Auto-ingest will work only for occurrences whose recording and transcript Webex makes
            available to your account—for example, because you are a cohost or the recording was
            shared with you. A calendar invitation or attendance alone does not guarantee access.
            Unavailable occurrences will retry and then be skipped.
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAccessWarningCandidate(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-amber-600 text-white hover:bg-amber-700"
              disabled={!accessWarningCandidate || mutating === accessWarningCandidate.seriesKey}
              onClick={() => {
                const candidate = accessWarningCandidate;
                setAccessWarningCandidate(null);
                if (candidate) void add(candidate);
              }}
            >
              Add with warning
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
