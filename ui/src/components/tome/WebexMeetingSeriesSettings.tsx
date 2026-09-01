"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, Plus, Search, Trash2, TriangleAlert } from "lucide-react";

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
      }>;
      if (!response.ok) throw new Error(apiError(body, "Could not load meeting series."));
      setSubscriptions(body.data?.subscriptions ?? []);
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
            <div key={subscription.id} className="flex items-center gap-3 px-3 py-3">
              <input
                type="checkbox"
                aria-label={`Auto-ingest ${subscription.title}`}
                checked={subscription.enabled}
                disabled={!canEdit || mutating === subscription.id}
                onChange={(event) => void toggle(subscription, event.target.checked)}
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
                {subscription.lastError && (
                  <p className="mt-1 text-xs text-destructive">{subscription.lastError}</p>
                )}
              </div>
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
