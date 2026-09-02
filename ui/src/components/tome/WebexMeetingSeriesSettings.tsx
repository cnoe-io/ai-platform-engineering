"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronRight,
  FileClock,
  FileText,
  Loader2,
  Plus,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
      }>;
      if (!response.ok) {
        setErrorCode(body.code ?? "");
        throw new Error(apiError(body, "Could not find recurring meetings."));
      }
      setSubscriptions(body.data?.subscriptions ?? []);
      setCandidates(body.data?.candidates ?? []);
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
                    {subscription.lastError && (
                      <p
                        className={cn(
                          "mt-1 text-xs",
                          subscription.lastStatus === "failed" || subscription.lastStatus === "skipped"
                            ? "text-destructive"
                            : "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {meetingStatusMessage(subscription.lastError)}
                      </p>
                    )}
                  </div>
                </button>
                {mutating === subscription.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
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
                )}
              </div>
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
                                    occurrence.status === "failed" || occurrence.status === "skipped"
                                      ? "text-destructive"
                                      : "text-amber-600 dark:text-amber-400",
                                  )}
                                >
                                  {meetingStatusMessage(occurrence.lastError)}
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
                      className={`flex items-center gap-3 px-3 py-3 ${
                        candidate.canAutoIngest ? "" : "cursor-not-allowed opacity-50"
                      }`}
                      title={candidate.canAutoIngest ? undefined : candidate.unavailableReason}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{candidate.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {candidate.nextOccurrence
                            ? `Next: ${new Date(candidate.nextOccurrence.start).toLocaleString()}`
                            : "No upcoming occurrence in the next 90 days"}
                          {candidate.hostEmail ? ` · Host: ${candidate.hostEmail}` : ""}
                        </p>
                      </div>
                      {candidate.canAutoIngest ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={mutating === candidate.seriesKey}
                          onClick={() => void add(candidate)}
                        >
                          {mutating === candidate.seriesKey && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                          Add
                        </Button>
                      ) : (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="inline-flex cursor-not-allowed"
                                tabIndex={0}
                                aria-label="Only the meeting host can add this series"
                              >
                                <Button type="button" size="sm" disabled>
                                  Add
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              Only the meeting host can add this series.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
