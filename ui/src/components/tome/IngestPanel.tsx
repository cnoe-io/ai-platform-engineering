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
  Scissors,
  Search,
  Sprout,
  Square,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BhagProjectsPanel } from "@/components/tome/BhagProjectsPanel";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import { preflightState, type PreflightSourceResult } from "@/lib/tome/preflight";
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
  // Stored shape is { room_id, name, slug }; tolerate older { id, title } too.
  webex_rooms: Array<{
    room_id?: string;
    name?: string;
    slug?: string;
    id?: string;
    title?: string;
  }>;
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
  const roomLabels = rooms
    .map((r) => r.name || r.title || r.room_id || r.id || "")
    .filter(Boolean);
  if (roomLabels.length > 0) {
    rows.push({
      kind: "webex",
      label: "Webex",
      items: roomLabels,
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
  isBhag = false,
}: {
  slug: string;
  canEdit: boolean;
  onOpenRun: (runId: string) => void;
  onRunStarted: (runId: string) => void;
  /** BHAG synthesis mode: no sources, synthesizes from tagged child projects. */
  isBhag?: boolean;
}) {
  // Run state
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [seed, setSeed] = useState("");
  const [starting, setStarting] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runsOpen, setRunsOpen] = useState(false);

  // Sources + preflight access status
  const [sourceRows, setSourceRows] = useState<SourceRow[] | null>(null);
  const [preflight, setPreflight] = useState<PreflightSourceResult[] | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(true);
  const [projectName, setProjectName] = useState("");

  // Greenfield seeding — opt-in. Off by default: stable pages stay human-owned
  // unless the user explicitly authorizes a best-effort agent draft.
  const [seedPages, setSeedPages] = useState(false);

  // BHAG only — opt-in. Re-ingest every child project first, then synthesize
  // (a cascade run through the queue). Off by default since it's slow/expensive.
  const [refreshChildren, setRefreshChildren] = useState(false);
  // Tagged-project count, reported by BhagProjectsPanel for the section title.
  const [bhagCount, setBhagCount] = useState<number | null>(null);

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

  // ── Load sources + preflight access check ─────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setPreflightLoading(true);

    Promise.all([
      fetch(`/api/projects/${slug}`).then((r) => r.json()),
      fetch(`/api/tome/projects/${slug}/preflight`, { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([projJson, preflightJson]) => {
        if (cancelled) return;
        const proj = projJson?.data?.project ?? {};
        setProjectName(proj.name ?? proj.title ?? "");
        const s = proj.sources ?? {};
        setSourceRows(sourcesFromProject(s));
        setPreflight(preflightJson?.data?.sources ?? null);
      })
      .catch(() => {
        if (!cancelled) { setSourceRows([]); setPreflight(null); }
      })
      .finally(() => {
        if (!cancelled) setPreflightLoading(false);
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

  const isGreenfield = runs !== null && runs.length === 0;

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    const selectedList = (meetings ?? []).filter((m) => selectedMeetings.has(m.id));
    // BHAGs synthesize from tagged children via /synthesize (no sources/meetings);
    // regular projects pull their sources via /reingest.
    const endpoint = isBhag ? "synthesize" : "reingest";
    const payload = isBhag
      ? {
          seed: seed.trim() || undefined,
          seedStablePages: isGreenfield ? seedPages : undefined,
          refreshChildren: refreshChildren || undefined,
        }
      : {
          seed: seed.trim() || undefined,
          webexMeetings: selectedList.length > 0 ? selectedList : undefined,
          seedStablePages: isGreenfield ? seedPages : undefined,
        };
    try {
      const res = await fetch(`/api/tome/projects/${slug}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `${endpoint} failed (${res.status})`);
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
  }, [slug, seed, meetings, selectedMeetings, loadRuns, onRunStarted, isGreenfield, seedPages, refreshChildren, isBhag]);

  // Compaction — an in-place editing pass (tighten prose, fix stale tome:// links).
  // Its own run through the shared lifecycle; shows in the same log + history.
  const compact = useCallback(async () => {
    setCompacting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/compact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: seed.trim() || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `compaction failed (${res.status})`);
      }
      const json = await res.json();
      setSeed("");
      await loadRuns();
      onRunStarted(json.data.runId);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setCompacting(false);
    }
  }, [slug, seed, loadRuns, onRunStarted]);

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
            <h2 className="text-lg font-semibold">
              {isBhag ? "Synthesize BHAG" : "Run ingest"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isBhag
                ? "Synthesize this BHAG's wiki from the projects tagged to it. The agent reads their wikis. A BHAG has no sources of its own."
                : "Re-run the agent over this project's sources to refresh the dynamic wiki."}
            </p>
          </div>

          {/* BHAG: the projects rolled up, in place of source preflight. */}
          {isBhag ? (
            <div className="rounded-lg border">
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <span className="text-sm font-medium">
                  Projects in this synthesis{bhagCount !== null ? ` (${bhagCount})` : ""}
                </span>
                <a
                  href={`/projects/${slug}/tome/settings`}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Manage <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="px-4 py-3">
                {projectName ? (
                  <BhagProjectsPanel bhagName={projectName} preflight onCount={setBhagCount} />
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading projects…
                  </p>
                )}
              </div>
              <label className="flex cursor-pointer items-start gap-2 border-t px-4 py-3">
                <input
                  type="checkbox"
                  checked={refreshChildren}
                  onChange={(e) => setRefreshChildren(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span className="font-medium">Re-ingest child projects first</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Runs a fresh ingest of each project above before synthesizing, so
                    the roll-up reflects their latest sources. Slower, uses your
                    connected credentials, and runs a few at a time.
                  </span>
                </span>
              </label>
            </div>
          ) : (
          /* Sources preflight */
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
              {preflightLoading ? (
                <li className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking access…
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
                  const pf = preflight?.find((p) => p.provider === row.kind);
                  const state = preflightState(pf);
                  const inaccessible = pf?.inaccessible ?? [];
                  const accessible = pf?.accessible ?? [];
                  // green (all ok) / amber (connected, access issues) / red (no token)
                  const noToken = state === "no_token";
                  const allOk = state === "ok";
                  const accessIssue = state === "access_issue";

                  const tooltipText = noToken
                    ? `${row.label} not connected: ingest will skip this source`
                    : inaccessible.length > 0
                      ? `Connected but no access to: ${inaccessible.join(", ")}`
                      : pf
                        ? `${row.label}: access confirmed for all sources`
                        : `${row.label}: access not yet verified`;

                  return (
                    <li key={row.kind} className="flex items-start gap-3 px-4 py-3">
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {allOk ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 cursor-default text-emerald-500" />
                            ) : accessIssue ? (
                              <XCircle className="mt-0.5 h-4 w-4 shrink-0 cursor-default text-amber-500" />
                            ) : noToken ? (
                              <XCircle className="mt-0.5 h-4 w-4 shrink-0 cursor-default text-destructive" />
                            ) : (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 cursor-default text-muted-foreground" />
                            )}
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-64 whitespace-normal">
                            {tooltipText}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          <ProviderLogo provider={row.connectorKey} className="h-3.5 w-3.5 shrink-0 object-contain" />
                          {row.label}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {inaccessible.length > 0 ? (
                            <>
                              <span className="text-amber-500">{inaccessible.join(", ")}</span>
                              {accessible.length > 0 ? `, ${accessible.join(", ")}` : ""}
                            </>
                          ) : (
                            row.items.join(", ")
                          )}
                        </p>
                      </div>
                      {(noToken || accessIssue) && (
                        <a
                          href="/credentials"
                          className="shrink-0 text-xs text-primary hover:underline"
                        >
                          {noToken ? "Connect →" : "Fix access →"}
                        </a>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
          )}

          {/* Add context */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Add context for this run</p>

            {/* Webex meeting picker — projects only (a BHAG has no Webex). */}
            {!isBhag && (
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
                    Select meetings to include. The agent will pull whatever is available
                    (AI summary and/or transcript). Per-run only, not saved to the project.
                    Webex only exposes meetings you hosted or that have a transcript you can
                    access; meetings hosted by others may not appear.
                  </p>
                  {/* Filter — disabled until meetings load, like the source picker. */}
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Filter meetings…"
                      value={meetingFilter}
                      onChange={(e) => setMeetingFilter(e.target.value)}
                      disabled={meetingsLoading || !meetings || meetings.length === 0}
                      className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                    />
                  </div>

                  {/* Fixed-height scroll region so a long history doesn't blow out
                      the panel. Skeleton rows while loading (source-picker style). */}
                  <div className="h-52 overflow-y-auto rounded-md border">
                    {meetingsLoading ? (
                      <ul className="divide-y" aria-hidden>
                        {Array.from({ length: 6 }).map((_, i) => (
                          <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                            <span className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
                            <span className="h-3 flex-1 animate-pulse rounded bg-muted" />
                            <span className="h-3 w-16 shrink-0 animate-pulse rounded bg-muted" />
                          </li>
                        ))}
                      </ul>
                    ) : !meetings || meetings.length === 0 ? (
                      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                        No meetings found. Connect Webex in
                        <a href="/credentials" className="mx-1 underline">
                          /credentials
                        </a>
                        if you haven&apos;t.
                      </div>
                    ) : filteredMeetings.length === 0 ? (
                      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                        No meetings match &ldquo;{meetingFilter}&rdquo;.
                      </div>
                    ) : (
                      <ul className="divide-y">
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
                                  unavailableReason="No AI summary: meeting may still be processing"
                                />
                                <MeetingBadge
                                  label="Transcript"
                                  available={m.hasTranscript}
                                  unavailableReason="No transcript: Webex Assistant wasn't enabled for this meeting"
                                />
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
            )}

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

            {/* First ingest — stable-page seeding (greenfield only) */}
            {isGreenfield && (
              <div className="rounded-lg border border-emerald-800/30 bg-emerald-950/20 px-4 py-3">
                <div className="flex items-start gap-3">
                  <Sprout className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <div className="flex-1 space-y-2.5">
                    <div>
                      <p className="text-sm font-medium text-emerald-300">First ingest</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        No previous ingests for this project. The agent will build the wiki from
                        scratch.
                      </p>
                    </div>
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={seedPages}
                        onChange={(e) => setSeedPages(e.target.checked)}
                        disabled={!canEdit || starting}
                        className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                      />
                      <span className="text-sm">
                        Let the agent draft the stable pages
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          By default Charter, Objectives, and Roadmap stay yours to write. Check this
                          to let the agent take a best-effort first pass at them from your sources,
                          clearly marked as a draft. Only safe if a human reviews and edits the
                          result afterward. The agent can be wrong.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Run bar */}
          <div className="rounded-lg border px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button
                onClick={() => void start()}
                disabled={!canEdit || starting || compacting || inProgress}
                title={
                  !canEdit
                    ? `You need edit access to ${isBhag ? "synthesize" : "run an ingest"}`
                    : inProgress
                      ? `A ${isBhag ? "synthesis" : "ingest"} is already running`
                      : isBhag
                        ? "Synthesize BHAG"
                        : "Run ingest"
                }
              >
                {starting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {starting ? "Starting…" : isBhag ? "Synthesize" : "Run ingest"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void compact()}
                disabled={!canEdit || starting || compacting || inProgress || isGreenfield}
                title={
                  !canEdit
                    ? "You need edit access to compact"
                    : isGreenfield
                      ? "Run an ingest first — there's nothing to compact yet"
                      : inProgress
                        ? "A run is already in progress"
                        : "Tighten the wiki's prose and fix stale links"
                }
              >
                {compacting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Scissors className="h-4 w-4" />
                )}
                {compacting ? "Compacting…" : "Compact"}
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
