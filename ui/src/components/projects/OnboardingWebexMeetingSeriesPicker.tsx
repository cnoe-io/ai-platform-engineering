"use client";

import Link from "next/link";
import { CalendarDays, Loader2, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

interface Candidate {
  seriesKey: string;
  title: string;
  hostEmail?: string;
  canAutoIngest: boolean;
  unavailableReason?: string;
  nextOccurrence?: { start: string };
}

interface ApiEnvelope {
  data?: { candidates?: Candidate[] };
  error?: string | { message?: string };
  message?: string;
  code?: string;
}

const CONNECTION_REQUIRED = "WEBEX_MEETINGS_CONNECTION_REQUIRED";

function errorMessage(body: ApiEnvelope): string {
  if (typeof body.error === "string") return body.error;
  return body.error?.message || body.message || "Could not find recurring Webex meetings.";
}

export function OnboardingWebexMeetingSeriesPicker({
  selectedSeriesKeys,
  onSelectedSeriesKeysChange,
}: {
  selectedSeriesKeys: string[];
  onSelectedSeriesKeysChange: (keys: string[]) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const discover = useCallback(async () => {
    setLoading(true);
    setError("");
    setErrorCode("");
    try {
      const response = await fetch("/api/tome/webex-meeting-series", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as ApiEnvelope;
      if (!response.ok) {
        setErrorCode(body.code ?? "");
        throw new Error(errorMessage(body));
      }
      const nextCandidates = body.data?.candidates ?? [];
      setCandidates(nextCandidates);
      const eligibleKeys = new Set(
        nextCandidates.filter((candidate) => candidate.canAutoIngest).map((candidate) => candidate.seriesKey),
      );
      onSelectedSeriesKeysChange(selectedSeriesKeys.filter((key) => eligibleKeys.has(key)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not find recurring Webex meetings.");
    } finally {
      setLoading(false);
    }
  }, [onSelectedSeriesKeysChange, selectedSeriesKeys]);

  useEffect(() => {
    void discover();
    // Discover once whenever the picker is opened. Refresh is explicit after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleCandidates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter((candidate) =>
      [candidate.title, candidate.hostEmail].some((value) => value?.toLowerCase().includes(query)),
    );
  }, [candidates, searchQuery]);

  const toggle = (candidate: Candidate) => {
    if (!candidate.canAutoIngest) return;
    const selected = selectedSeriesKeys.includes(candidate.seriesKey);
    onSelectedSeriesKeysChange(
      selected
        ? selectedSeriesKeys.filter((key) => key !== candidate.seriesKey)
        : [...selectedSeriesKeys, candidate.seriesKey],
    );
  };

  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-background/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="h-4 w-4" /> Recurring Webex meetings
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose meeting series to ingest after each occurrence ends and its transcripts are ready.
            These follow the Webex calendar, not the daily or weekly schedule above.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void discover()}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding recurring meetings…
        </p>
      ) : error ? (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
          <p className="flex items-start gap-1.5">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
          {errorCode === CONNECTION_REQUIRED && (
            <Link href="/credentials#connections" className="mt-2 inline-block font-medium text-primary underline">
              Connect Webex (Meetings)
            </Link>
          )}
        </div>
      ) : candidates.length === 0 ? (
        <p className="py-6 text-xs text-muted-foreground">No recurring Webex meetings were found.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Search recurring Webex meetings"
              placeholder="Search by meeting title or host"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {visibleCandidates.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No meetings match “{searchQuery.trim()}”.
            </p>
          ) : (
            <div className="max-h-64 divide-y overflow-y-auto rounded-lg border border-border/60">
              {visibleCandidates.map((candidate) => {
                const selected = selectedSeriesKeys.includes(candidate.seriesKey);
                return (
                  <label
                    key={candidate.seriesKey}
                    className={cn(
                      "flex items-center gap-3 px-3 py-3",
                      candidate.canAutoIngest
                        ? "cursor-pointer hover:bg-accent/30"
                        : "cursor-not-allowed bg-muted/20 opacity-50",
                    )}
                    title={candidate.canAutoIngest ? undefined : "Only the meeting host can add this series."}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!candidate.canAutoIngest}
                      onChange={() => toggle(candidate)}
                      aria-label={`Select ${candidate.title}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{candidate.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {candidate.nextOccurrence
                          ? `Next: ${new Date(candidate.nextOccurrence.start).toLocaleString()}`
                          : "No upcoming occurrence in the next 90 days"}
                        {candidate.hostEmail ? ` · Host: ${candidate.hostEmail}` : ""}
                      </span>
                      {!candidate.canAutoIngest && (
                        <span className="block text-[11px] text-muted-foreground">
                          Only the meeting host can add this series.
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {selectedSeriesKeys.length} meeting series selected
          </p>
        </div>
      )}
    </div>
  );
}
