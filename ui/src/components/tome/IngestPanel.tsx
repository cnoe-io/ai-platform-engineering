"use client";

import { useCallback, useEffect, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { ChevronDown, ChevronRight, Loader2, Play, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectAssets } from "@/components/tome/ProjectAssets";
import { cn } from "@/lib/utils";

interface RunSummary {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  greenfield: boolean;
  started_at: string;
  finished_at: string | null;
  log_lines: number;
  error: string | null;
}

interface WebexMeeting {
  id: string;
  title: string;
  start: string;
  hasSummary: boolean;
  hasTranscript: boolean;
}

/**
 * Ingest landing — kick a run (optional one-shot seed instruction) and browse
 * recent runs. Selecting a run opens its log. Port of TTT's `ReingestButton`
 * dialog + the run list from `IngestHistoryPanel`.
 */
export function IngestPanel({
  slug,
  canEdit,
  onOpenRun,
  onRunStarted,
}: {
  slug: string;
  canEdit: boolean;
  onOpenRun: (runId: string) => void;
  onRunStarted: (runId: string) => void;
}) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [seed, setSeed] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Webex meeting picker
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [meetings, setMeetings] = useState<WebexMeeting[] | null>(null);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [selectedMeetings, setSelectedMeetings] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tome/projects/${slug}/ingests`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const json = await res.json();
      setRuns(json?.data?.runs ?? []);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [slug]);

  useEffect(() => {
    void load();
    // Refresh the list while something is running so statuses settle.
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  const inProgress = (runs ?? []).some(
    (r) => r.status === "running" || r.status === "queued",
  );

  const loadMeetings = useCallback(async () => {
    if (meetings !== null) return; // already fetched
    setMeetingsLoading(true);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/webex-meetings`);
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      const json = await res.json();
      setMeetings(json?.data?.meetings ?? []);
    } catch {
      setMeetings([]);
    } finally {
      setMeetingsLoading(false);
    }
  }, [slug, meetings]);

  const toggleMeetingsOpen = useCallback(() => {
    setMeetingsOpen((prev) => {
      if (!prev) void loadMeetings();
      return !prev;
    });
  }, [loadMeetings]);

  const toggleMeeting = useCallback((id: string) => {
    setSelectedMeetings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    const selectedList = (meetings ?? []).filter((m) => selectedMeetings.has(m.id));
    try {
      const res = await fetch(`/api/tome/projects/${slug}/reingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed: seed.trim() || undefined,
          webexMeetings: selectedList.length > 0 ? selectedList : undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `reingest failed (${res.status})`);
      }
      const json = await res.json();
      setSeed("");
      setSelectedMeetings(new Set());
      await load();
      onRunStarted(json.data.runId);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setStarting(false);
    }
  }, [slug, seed, meetings, selectedMeetings, load, onRunStarted]);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div>
          <h2 className="text-lg font-semibold">Run ingest agent</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Re-run the agent over this project&apos;s sources to refresh the
            dynamic wiki pages. Stable pages are preserved.
          </p>
        </div>

        {/* Sources the agent reads (and that scope its MCP). */}
        <ProjectAssets slug={slug} canEdit={canEdit} />

        {/* Webex meeting picker — per-ingest, not saved to project config */}
        <div className="rounded-lg border">
          <button
            type="button"
            onClick={toggleMeetingsOpen}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted"
          >
            {meetingsOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span>Recorded meetings</span>
            {selectedMeetings.size > 0 && (
              <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {selectedMeetings.size} selected
              </span>
            )}
          </button>
          {meetingsOpen && (
            <div className="border-t px-4 pb-3 pt-2">
              <p className="mb-2 text-xs text-muted-foreground">
                Select recordings to include in this ingest run. The agent will pull
                whatever is available — AI summary and/or transcript. Selection is
                per-run and not saved to the project.
              </p>
              {meetingsLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </p>
              ) : !meetings || meetings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No recorded meetings found, or Webex is not connected.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {meetings.map((m) => (
                    <li key={m.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted">
                        <input
                          type="checkbox"
                          checked={selectedMeetings.has(m.id)}
                          onChange={() => toggleMeeting(m.id)}
                          disabled={!canEdit || starting}
                          className="h-4 w-4 rounded border-input accent-primary"
                        />
                        <span className="flex-1 truncate font-medium">{m.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {new Date(m.start).toLocaleDateString()}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <MeetingBadge
                            label="Summary"
                            available={m.hasSummary}
                            unavailableReason="No AI summary — meeting may still be processing"
                          />
                          <MeetingBadge
                            label="Transcript"
                            available={m.hasTranscript}
                            unavailableReason="No transcript — Webex Assistant wasn't enabled for this meeting"
                          />
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Reingest control */}
        <div className="rounded-lg border p-4">
          <label className="mb-1 block text-sm font-medium">
            Seed instruction <span className="text-muted-foreground">(optional)</span>
          </label>
          <p className="mb-2 text-xs text-muted-foreground">
            A one-shot nudge for this run, e.g. &ldquo;focus on the auth
            refactor&rdquo;. Doesn&apos;t override page-kind preservation.
          </p>
          <TextareaAutosize
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            minRows={2}
            maxRows={6}
            placeholder="(blank = standard ingest)"
            disabled={!canEdit || starting}
            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <div className="mt-3 flex items-center gap-3">
            <Button
              onClick={() => void start()}
              disabled={!canEdit || starting || inProgress}
              title={
                !canEdit
                  ? "You need edit access to run an ingest"
                  : inProgress
                    ? "An ingest is already running"
                    : "Run ingest"
              }
            >
              {starting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {starting ? "Starting…" : inProgress ? "Ingest running…" : "Run ingest"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void load()} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>

        {/* Run history */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            Recent runs
          </h3>
          {runs === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ingests yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpenRun(r.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <StatusPill status={r.status} />
                    {r.greenfield && (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
                        greenfield
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {new Date(r.started_at).toLocaleString()}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {durationLabel(r)} · {r.log_lines} lines
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

function durationLabel(r: RunSummary): string {
  if (!r.finished_at) return "running";
  const s = Math.round(
    (new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000,
  );
  return `${s}s`;
}

function MeetingBadge({
  label,
  available,
  unavailableReason,
}: {
  label: string;
  available: boolean;
  unavailableReason: string;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "cursor-default rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide transition-opacity",
              available
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-muted text-muted-foreground opacity-40",
            )}
          >
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {available ? `${label} available` : unavailableReason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function StatusPill({ status }: { status: RunSummary["status"] }) {
  const cls =
    status === "succeeded"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
      : status === "failed"
        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        cls,
      )}
    >
      {status}
    </span>
  );
}
