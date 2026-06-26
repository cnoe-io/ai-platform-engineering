"use client";

import { useCallback, useEffect, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Play,
  Search,
  Square,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface ProjectSources {
  repos: string[];
  confluence_url: string;
  webex_rooms: Array<{ id: string; title?: string }>;
}

interface SourceRow {
  kind: "github" | "confluence" | "webex";
  label: string;
  items: string[];
  connectorKey: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function durationLabel(r: RunSummary): string {
  if (!r.finished_at) return "running";
  const s = Math.round(
    (new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000,
  );
  return `${s}s`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function sourcesFromProject(s: Partial<ProjectSources>): SourceRow[] {
  const rows: SourceRow[] = [];
  const repos = Array.isArray(s.repos) ? s.repos.filter(Boolean) : [];
  if (repos.length > 0) {
    rows.push({ kind: "github", label: "GitHub", items: repos, connectorKey: "github" });
  }
  if (typeof s.confluence_url === "string" && s.confluence_url.trim()) {
    rows.push({
      kind: "confluence",
      label: "Confluence",
      items: [s.confluence_url.trim()],
      connectorKey: "atlassian",
    });
  }
  const rooms = Array.isArray(s.webex_rooms) ? s.webex_rooms : [];
  if (rooms.length > 0) {
    rows.push({
      kind: "webex",
      label: "Webex",
      items: rooms.map((r) => r.title ?? r.id),
      connectorKey: "webex",
    });
  }
  return rows;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: RunSummary["status"] }) {
  const cls =
    status === "succeeded"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
      : status === "failed"
        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", cls)}>
      {status}
    </span>
  );
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

function RunsDialog({
  open,
  onOpenChange,
  runs,
  onOpenRun,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  runs: RunSummary[];
  onOpenRun: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Ingest history</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          {runs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No ingests yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => { onOpenRun(r.id); onOpenChange(false); }}
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
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

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
  // Run state
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [seed, setSeed] = useState("");
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runsOpen, setRunsOpen] = useState(false);

  // Sources + credential status
  const [sourceRows, setSourceRows] = useState<SourceRow[] | null>(null);
  const [connectedKeys, setConnectedKeys] = useState<Set<string>>(new Set());
  const [sourcesLoading, setSourcesLoading] = useState(true);

  // Meeting picker
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [meetings, setMeetings] = useState<WebexMeeting[] | null>(null);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [selectedMeetings, setSelectedMeetings] = useState<Set<string>>(new Set());
  const [meetingFilter, setMeetingFilter] = useState("");

  // ── Load runs ──────────────────────────────────────────────────────────────

  const loadRuns = useCallback(async () => {
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
    void loadRuns();
    const t = setInterval(loadRuns, 2500);
    return () => clearInterval(t);
  }, [loadRuns]);

  // ── Load sources + credential coverage ────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setSourcesLoading(true);

    Promise.all([
      fetch(`/api/projects/${slug}`).then((r) => r.json()),
      fetch("/api/credentials/connections").then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
    ])
      .then(([projJson, connJson]) => {
        if (cancelled) return;
        const s = projJson?.data?.project?.sources ?? {};
        setSourceRows(sourcesFromProject(s));

        const connections: Array<{ provider?: string; status?: string }> =
          connJson?.data ?? [];
        const keys = new Set(
          connections
            .filter((c) => c.status === "connected")
            .map((c) => c.provider ?? "")
            .filter(Boolean),
        );
        setConnectedKeys(keys);
      })
      .catch(() => {
        if (!cancelled) { setSourceRows([]); }
      })
      .finally(() => {
        if (!cancelled) setSourcesLoading(false);
      });

    return () => { cancelled = true; };
  }, [slug]);

  // ── Meetings ───────────────────────────────────────────────────────────────

  const loadMeetings = useCallback(async () => {
    if (meetings !== null) return;
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

  // ── Start ingest ───────────────────────────────────────────────────────────

  const activeRun = (runs ?? []).find(
    (r) => r.status === "running" || r.status === "queued",
  );
  const inProgress = Boolean(activeRun);

  const stopRun = useCallback(async () => {
    if (!activeRun) return;
    setStopping(true);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/ingests/${activeRun.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `stop failed (${res.status})`);
      }
      await loadRuns();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setStopping(false);
    }
  }, [activeRun, slug, loadRuns]);

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
      await loadRuns();
      onRunStarted(json.data.runId);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setStarting(false);
    }
  }, [slug, seed, meetings, selectedMeetings, loadRuns, onRunStarted]);

  const lastRun = runs?.[0] ?? null;
  const filteredMeetings = (meetings ?? []).filter((m) =>
    m.title.toLowerCase().includes(meetingFilter.toLowerCase()),
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <ScrollArea className="h-full">
        <div className="mx-auto max-w-2xl space-y-5 px-6 py-8">

          {/* Header */}
          <div>
            <h2 className="text-lg font-semibold">Run ingest</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Re-run the agent over this project&apos;s sources to refresh the dynamic wiki.
            </p>
          </div>

          {/* Sources preflight */}
          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="text-sm font-medium">Project sources</span>
              <a
                href={`/projects/${slug}/tome/settings`}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Edit <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <ul className="divide-y">
              {sourcesLoading ? (
                <li className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sources…
                </li>
              ) : !sourceRows || sourceRows.length === 0 ? (
                <li className="px-4 py-3 text-sm text-muted-foreground">
                  No sources configured.{" "}
                  <a href={`/projects/${slug}/tome/settings`} className="underline">
                    Add sources →
                  </a>
                </li>
              ) : (
                sourceRows.map((row) => {
                  const ok = connectedKeys.has(row.connectorKey);
                  return (
                    <li key={row.kind} className="flex items-start gap-3 px-4 py-3">
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {ok ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 cursor-default text-emerald-500" />
                            ) : (
                              <XCircle className="mt-0.5 h-4 w-4 shrink-0 cursor-default text-destructive" />
                            )}
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {ok
                              ? `${row.label} connected — will be ingested`
                              : `${row.label} not connected — ingest will skip this source`}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{row.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.items.join(", ")}
                        </p>
                      </div>
                      {!ok && (
                        <a
                          href="/credentials"
                          className="shrink-0 text-xs text-primary hover:underline"
                        >
                          Connect →
                        </a>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          {/* Add context */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Add context for this run</p>

            {/* Webex meeting picker */}
            <div className="rounded-lg border">
              <button
                type="button"
                onClick={toggleMeetingsOpen}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
              >
                {meetingsOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span>Recorded Webex meetings</span>
                {selectedMeetings.size > 0 && (
                  <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {selectedMeetings.size} selected
                  </span>
                )}
              </button>

              {meetingsOpen && (
                <div className="border-t px-4 pb-3 pt-2">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Select recordings to include — the agent will pull whatever is available
                    (AI summary and/or transcript). Per-run only, not saved to the project.
                  </p>
                  {meetingsLoading ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                    </p>
                  ) : !meetings || meetings.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No recorded meetings found. Make sure Webex is connected in{" "}
                      <a href="/credentials" className="underline">
                        /credentials
                      </a>
                      .
                    </p>
                  ) : (
                    <>
                      <div className="relative mb-2">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="text"
                          placeholder="Filter meetings…"
                          value={meetingFilter}
                          onChange={(e) => setMeetingFilter(e.target.value)}
                          className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      {filteredMeetings.length === 0 ? (
                        <p className="py-2 text-center text-sm text-muted-foreground">
                          No meetings match &ldquo;{meetingFilter}&rdquo;.
                        </p>
                      ) : (
                        <ul className="divide-y rounded-md border">
                          {filteredMeetings.map((m) => (
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
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Seed instruction */}
            <div>
              <label className="mb-1 block text-sm">
                Seed instruction{" "}
                <span className="text-muted-foreground">(optional)</span>
              </label>
              <TextareaAutosize
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                minRows={2}
                maxRows={6}
                placeholder={'A one-shot nudge for this run, e.g. "focus on the auth refactor"'}
                disabled={!canEdit || starting}
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
            </div>
          </div>

          {/* Run bar */}
          <div className="rounded-lg border px-4 py-3">
            <div className="flex items-center gap-3">
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
                {starting ? "Starting…" : "Run ingest"}
              </Button>
              {inProgress && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void stopRun()}
                  disabled={stopping}
                >
                  {stopping ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="h-4 w-4 fill-current" />
                  )}
                  {stopping ? "Stopping…" : "Stop"}
                </Button>
              )}

              <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                {runs === null ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : lastRun ? (
                  <>
                    <span>Last run:</span>
                    <StatusPill status={lastRun.status} />
                    <span>{timeAgo(lastRun.started_at)}</span>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => onOpenRun(lastRun.id)}
                      className="text-primary hover:underline"
                    >
                      Open log
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => setRunsOpen(true)}
                      className="text-primary hover:underline"
                    >
                      History ({runs.length})
                    </button>
                  </>
                ) : (
                  <span>No ingests yet.</span>
                )}
              </div>
            </div>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </div>
        </div>
      </ScrollArea>

      <RunsDialog
        open={runsOpen}
        onOpenChange={setRunsOpen}
        runs={runs ?? []}
        onOpenRun={onOpenRun}
      />
    </>
  );
}
