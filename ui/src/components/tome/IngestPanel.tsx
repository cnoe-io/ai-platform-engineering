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
  Video,
  XCircle,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChildProjectsPanel } from "@/components/tome/BhagProjectsPanel";
import { PanelShell } from "@/components/tome/PanelHeader";
import { ViewOnlyTooltip } from "@/components/tome/ViewOnlyTooltip";
import { ProviderLogo } from "@/components/credentials/provider-logo";
import {
  normalizeConfluencePageScope,
  normalizeConfluencePageScopes,
  parseConfluenceUrl,
} from "@/lib/projects/confluence-source";
import { preflightState, type PreflightSourceResult } from "@/lib/tome/preflight";
import { describeRelativeTime, nextCronRun } from "@/lib/tome/auto-ingest/schedule-presets";
import { cn } from "@/lib/utils";
import type { AutoIngestConfig, ConfluencePageScope } from "@/types/projects";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunSummary {
  id: string;
  status: "queued" | "running" | "awaiting_review" | "succeeded" | "failed";
  greenfield: boolean;
  started_at: string;
  finished_at: string | null;
  log_lines: number;
  error: string | null;
  review_deadline?: string | null;
  review_outcome?: "approved" | "rejected" | "auto_promoted" | null;
  reviewed_by?: string | null;
  report_id?: string | null;
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
  confluence_page_scopes?: unknown;
  confluence_page_scope?: unknown;
  // Stored shape is { room_id, name, slug }; tolerate older { id, title } too.
  webex_rooms: Array<{
    room_id?: string;
    name?: string;
    slug?: string;
    id?: string;
    title?: string;
  }>;
}

interface SourceItem {
  label: string;
  detail?: string;
  href?: string;
}

interface SourceRow {
  kind: "github" | "confluence" | "webex";
  label: string;
  items: SourceItem[];
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

function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return "any moment";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "in under a minute";
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

function confluencePageHref(
  sourceUrl: string,
  scope: ConfluencePageScope,
): string | undefined {
  const parsed = parseConfluenceUrl(sourceUrl);
  if (!parsed) return undefined;
  return `${parsed.base_url}/wiki/spaces/${encodeURIComponent(scope.space_key)}/pages/${encodeURIComponent(scope.page_id)}`;
}

function savedConfluenceScopes(s: Partial<ProjectSources>): ConfluencePageScope[] {
  const scopes = normalizeConfluencePageScopes(s.confluence_page_scopes);
  if (scopes.length > 0) return scopes;
  const legacyScope = normalizeConfluencePageScope(s.confluence_page_scope);
  return legacyScope ? [legacyScope] : [];
}

export function sourcesFromProject(s: Partial<ProjectSources>): SourceRow[] {
  const rows: SourceRow[] = [];
  const repos = Array.isArray(s.repos) ? s.repos.filter(Boolean) : [];
  if (repos.length > 0) {
    rows.push({
      kind: "github",
      label: "GitHub",
      items: repos.map((repo) => ({ label: repo })),
      connectorKey: "github",
    });
  }
  if (typeof s.confluence_url === "string" && s.confluence_url.trim()) {
    const sourceUrl = s.confluence_url.trim();
    const scopes = savedConfluenceScopes(s);
    const parsed = parseConfluenceUrl(sourceUrl);
    const spaceKey = scopes[0]?.space_key ?? parsed?.space_key;
    rows.push({
      kind: "confluence",
      label: "Confluence",
      items:
        scopes.length > 0
          ? scopes.map((scope) => ({
              label: scope.page_title,
              detail: `Space ${scope.space_key} · ${
                scope.include_descendants
                  ? "This page and all subpages"
                  : "This page only"
              }`,
              href: confluencePageHref(sourceUrl, scope),
            }))
          : parsed?.page_id
            ? [
                {
                  label: `Page ${parsed.page_id}`,
                  detail: `Space ${spaceKey ?? "unknown"} · This page and all subpages`,
                  href: sourceUrl,
                },
              ]
          : [
              {
                label: spaceKey ? `Entire ${spaceKey} space` : "Entire space",
                detail: sourceUrl,
                href: sourceUrl,
              },
            ],
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
      items: roomLabels.map((room) => ({ label: room })),
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

function initialsOf(email: string): string {
  const local = email.split("@")[0] || email;
  const parts = local.split(/[.\-_]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase() || "?";
}

/** Small avatar bubble for the reviewer who approved/rejected a run. */
function ReviewerAvatar({ email }: { email: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="gradient-primary-br flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium text-white">
            {initialsOf(email)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{email}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function RunsDialog({
  open,
  onOpenChange,
  runs,
  onOpenRun,
  onViewChanges,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  runs: RunSummary[];
  onOpenRun: (id: string) => void;
  onViewChanges: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Ingest history</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[65vh]">
          {runs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No ingests yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { onOpenRun(r.id); onOpenChange(false); }}
                    className="flex flex-1 items-center gap-4 px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <StatusPill status={r.status} />
                    <span className="w-40 shrink-0 truncate text-muted-foreground">
                      {new Date(r.started_at).toLocaleString()}
                    </span>
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">
                      {durationLabel(r)} · {r.log_lines}L
                    </span>
                    {r.greenfield && (
                      <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
                        greenfield
                      </span>
                    )}
                    <span className="min-w-0 flex-1" />
                    {r.review_outcome && (
                      <span className="flex items-center gap-1.5 shrink-0">
                        {r.reviewed_by && <ReviewerAvatar email={r.reviewed_by} />}
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                            r.review_outcome === "rejected"
                              ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
                          )}
                        >
                          {r.review_outcome === "auto_promoted" ? "auto-promoted" : r.review_outcome}
                        </span>
                      </span>
                    )}
                  </button>
                  {(r.status === "succeeded" || r.status === "awaiting_review") && r.report_id && (
                    <button
                      type="button"
                      onClick={() => { onViewChanges(r.id); onOpenChange(false); }}
                      className="shrink-0 rounded px-2 py-1 text-xs text-primary hover:underline"
                    >
                      View changes
                    </button>
                  )}
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
  onReviewDraft,
  onRunStarted,
  isSynthesized = false,
  entityKind = "bhag",
}: {
  slug: string;
  canEdit: boolean;
  onOpenRun: (runId: string) => void;
  /** Open the draft-review diff view for a run awaiting review. */
  onReviewDraft: (runId: string) => void;
  onRunStarted: (runId: string) => void;
  /** Synthesis mode (BHAG or Area): combines tagged child-project wikis with
   * any directly attached sources. */
  isSynthesized?: boolean;
  /** Which synthesized kind this is, for copy — only meaningful when
   * `isSynthesized`. */
  entityKind?: "bhag" | "area";
}) {
  // Run state
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [seed, setSeed] = useState("");
  const [starting, setStarting] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runsOpen, setRunsOpen] = useState(false);

  // "What do you want to do?" — a single action selector replaces the old
  // separate Run/Compact buttons + buried meeting-picker toggle. Each action
  // shows only the controls relevant to it below.
  const [action, setAction] = useState<"quick" | "full" | "meeting" | "compact">("full");

  // Sources + preflight access status
  const [sourceRows, setSourceRows] = useState<SourceRow[] | null>(null);
  const [preflight, setPreflight] = useState<PreflightSourceResult[] | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [autoIngest, setAutoIngest] = useState<AutoIngestConfig | undefined>(undefined);

  // Greenfield seeding — opt-in. Off by default: stable pages stay human-owned
  // unless the user explicitly authorizes a best-effort agent draft.
  const [seedPages, setSeedPages] = useState(false);

  // Synthesized types only — opt-in. Re-ingest every child project first, then synthesize
  // (a cascade run through the queue). Off by default since it's slow/expensive.
  const [refreshChildren, setRefreshChildren] = useState(false);
  // Tagged-project count, reported by ChildProjectsPanel for the section title.
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
        setProjectName(proj.slug ?? "");
        setAutoIngest(proj.autoIngest);
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

  // "Ingest meeting" is a single-purpose action — the picker is the whole
  // point, so it's always expanded (no collapse chrome) rather than buried
  // behind a toggle like it is under "Full ingest"'s optional add-context.
  useEffect(() => {
    if (action === "meeting") {
      setMeetingsOpen(true);
      void loadMeetings();
    }
  }, [action, loadMeetings]);

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
  const reviewRun = (runs ?? []).find((r) => r.status === "awaiting_review");
  const [draftPaths, setDraftPaths] = useState<string[] | null>(null);

  useEffect(() => {
    if (!reviewRun) {
      setDraftPaths(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/tome/projects/${slug}/ingests/${reviewRun.id}/draft-pages`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled) setDraftPaths(json?.data?.paths ?? []);
      })
      .catch(() => {
        if (!cancelled) setDraftPaths([]);
      });
    return () => { cancelled = true; };
  }, [slug, reviewRun]);

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
    // BHAGs/Areas synthesize tagged children plus direct sources via
    // /synthesize; regular projects pull direct sources via /reingest.
    const endpoint = isSynthesized ? "synthesize" : "reingest";
    // Quick edit only applies to the plain /reingest path — a targeted
    // point-edit, not a roll-up synthesis.
    const mode = !isSynthesized && action === "quick" ? "quick" : undefined;
    const payload = isSynthesized
      ? {
          seed: seed.trim() || undefined,
          seedStablePages: isGreenfield ? seedPages : undefined,
          refreshChildren: refreshChildren || undefined,
          webexMeetings: selectedList.length > 0 ? selectedList : undefined,
        }
      : {
          seed: seed.trim() || undefined,
          mode,
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
  }, [slug, seed, action, meetings, selectedMeetings, loadRuns, onRunStarted, isGreenfield, seedPages, refreshChildren, isSynthesized]);

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
      <PanelShell
        title={
          isSynthesized
            ? `Ingest sources & synthesize ${entityKind === "area" ? "Area" : "BHAG"}`
            : "Run ingest"
        }
        description={
          isSynthesized
            ? `Refresh this ${entityKind === "area" ? "area's" : "BHAG's"} attached sources, then synthesize them with its tagged project wikis.`
            : "Re-run the agent over this project's sources to refresh the dynamic wiki."
        }
      >

          {/* Draft awaiting review — a blocking state, called out above the
              card rather than folded into "what do you want to do". */}
          {reviewRun && (
            <div className="rounded-lg border border-amber-800/30 bg-amber-950/20 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-300">
                    Draft awaiting review
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    This run&apos;s page changes are held as a draft until approved.
                    {reviewRun.review_deadline && (
                      <> Auto-promotes {timeUntil(reviewRun.review_deadline)} if unreviewed.</>
                    )}{" "}
                    <button
                      type="button"
                      onClick={() => onOpenRun(reviewRun.id)}
                      className="text-primary hover:underline"
                    >
                      Open log
                    </button>
                  </p>
                  {draftPaths && draftPaths.length > 0 && (
                    <ul className="mt-1.5 flex flex-wrap gap-1">
                      {draftPaths.map((p) => (
                        <li
                          key={p}
                          className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[11px] text-amber-200"
                        >
                          {p}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Button size="sm" onClick={() => onReviewDraft(reviewRun.id)}>
                  Review diff
                </Button>
              </div>
            </div>
          )}

          {/* One card holds the whole "what do you want to do?" UX: action
              tabs on top, contextual sections as flat dividers (no nested
              boxes — the meeting/sources lists already scroll internally),
              and the run bar as the card's footer. */}
          <div className="overflow-hidden rounded-lg border">
            {/* "What do you want to do?" — action selector. Not shown for BHAG/Area
                synthesis, which has its own fixed ingest-and-synthesize flow. */}
            {!isSynthesized && (
              <TooltipProvider delayDuration={200}>
                <div className="flex flex-wrap gap-1.5 border-b bg-muted/30 p-2">
                  {(
                    [
                      {
                        key: "full" as const,
                        label: "Full ingest",
                        icon: Sprout,
                        disabled: false,
                        title: "Re-run the agent over every attached source",
                      },
                      {
                        key: "quick" as const,
                        label: "Quick edit",
                        icon: Zap,
                        disabled: isGreenfield,
                        title: isGreenfield
                          ? "Run a full ingest first — there's nothing to point-edit yet"
                          : "Make one targeted correction without re-scouring every source",
                      },
                      {
                        key: "meeting" as const,
                        label: "Ingest meeting",
                        icon: Video,
                        disabled: false,
                        title: "Pull a recorded Webex meeting's summary/transcript into the wiki",
                      },
                      {
                        key: "compact" as const,
                        label: "Compact",
                        icon: Scissors,
                        disabled: isGreenfield,
                        title: isGreenfield
                          ? "Run an ingest first — there's nothing to compact yet"
                          : "Tighten the wiki's prose and fix stale links",
                      },
                    ] as const
                  ).map((a) => (
                    <Tooltip key={a.key}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setAction(a.key)}
                          disabled={a.disabled}
                          aria-pressed={action === a.key}
                          className={cn(
                            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
                            action === a.key
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-background hover:text-foreground",
                          )}
                        >
                          <a.icon className="h-3.5 w-3.5" />
                          {a.label}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        {a.title}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </TooltipProvider>
            )}

            <div className="divide-y">
              {/* Synthesized entities also show the projects they roll up. */}
              {isSynthesized && (
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between">
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
                  <div className="mt-2">
                    {projectName ? (
                      <ChildProjectsPanel
                        bhagSlug={projectName}
                        entityKind={entityKind}
                        preflight
                        onCount={setBhagCount}
                      />
                    ) : (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading projects…
                      </p>
                    )}
                  </div>
                  <label className="mt-3 flex cursor-pointer items-start gap-2 border-t pt-3">
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
              )}

              {autoIngest?.enabled && (
                <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
                  <span>
                    Auto-ingest:{" "}
                    {(() => {
                      const next = nextCronRun(autoIngest.cron, new Date());
                      return next ? `next run ${describeRelativeTime(next, new Date())}` : "schedule configured";
                    })()}
                  </span>
                  <a
                    href={`/projects/${slug}/tome/settings?tab=auto-ingest`}
                    className="flex items-center gap-1 hover:text-foreground"
                  >
                    Edit schedule <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}

              {/* Sources preflight — irrelevant to a point edit or a meeting-only run. */}
              {(isSynthesized || action === "full") && (
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {isSynthesized ? "Attached sources" : "Project sources"}
                    </span>
                    <a
                      href={`/projects/${slug}/tome/settings`}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Edit <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <ul className="mt-1 divide-y">
                    {preflightLoading ? (
                      <li className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking access…
                      </li>
                    ) : !sourceRows || sourceRows.length === 0 ? (
                      <li className="py-3 text-sm text-muted-foreground">
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
                          ? `${row.label} not connected: the agent will skip this source`
                          : inaccessible.length > 0
                            ? `Connected but no access to: ${inaccessible.join(", ")}`
                            : pf
                              ? `${row.label}: access confirmed for all sources`
                              : `${row.label}: access not yet verified`;

                        return (
                          <li key={row.kind} className="flex items-start gap-3 py-3">
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
                              <ul className="mt-1 space-y-1">
                                {row.items.map((item) => (
                                  <li
                                    key={`${item.label}:${item.detail ?? ""}`}
                                    className="flex min-w-0 items-start gap-1.5 text-xs"
                                  >
                                    <span
                                      aria-hidden="true"
                                      className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60"
                                    />
                                    <span className="min-w-0">
                                      {item.href ? (
                                        <a
                                          href={item.href}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center gap-1 break-words text-foreground/90 hover:text-primary hover:underline"
                                        >
                                          {item.label}
                                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                        </a>
                                      ) : (
                                        <span className="break-words text-foreground/90">
                                          {item.label}
                                        </span>
                                      )}
                                      {item.detail ? (
                                        <span className="block break-words text-[11px] text-muted-foreground">
                                          {item.detail}
                                        </span>
                                      ) : null}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                              {inaccessible.length > 0 ? (
                                <p className="mt-1 text-xs text-amber-500">
                                  No access to {inaccessible.join(", ")}
                                  {accessible.length > 0
                                    ? `; access confirmed for ${accessible.join(", ")}`
                                    : ""}
                                </p>
                              ) : null}
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

              {/* Meeting picker — its own top-level action, or optional add-context
                  alongside a full ingest. Hidden for quick edit / compact. */}
              {(isSynthesized || action === "full" || action === "meeting") && (
                <div className="px-4 py-3">
                  {action === "meeting" ? (
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span>Recorded Webex meetings</span>
                      {selectedMeetings.size > 0 && (
                        <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {selectedMeetings.size} selected
                        </span>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={toggleMeetingsOpen}
                      className="flex w-full items-center gap-2 text-left text-sm"
                    >
                      {meetingsOpen ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="font-medium">Add context: recorded Webex meetings</span>
                      {selectedMeetings.size > 0 && (
                        <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {selectedMeetings.size} selected
                        </span>
                      )}
                    </button>
                  )}

                  {meetingsOpen && (
                    <div className="mt-2">
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
                          the panel — this is the one nested border, functional (marks the
                          scroll boundary), not decorative. Skeleton rows while loading. */}
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

              {/* Seed instruction — always shown; copy adapts to the selected action.
                  Hidden for compact, which doesn't take one. */}
              {action !== "compact" && (
                <div className="px-4 py-3">
                  <label className="mb-1 block text-sm">
                    {action === "quick" ? "What needs to change" : "Seed instruction"}{" "}
                    <span className="text-muted-foreground">
                      {action === "quick" ? "" : "(optional)"}
                    </span>
                  </label>
                  <TextareaAutosize
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    minRows={2}
                    maxRows={6}
                    placeholder={
                      action === "quick"
                        ? 'Describe the one correction to make, e.g. "the architecture page says we still use EC2 — we moved to k8s last quarter"'
                        : action === "meeting"
                          ? 'Optional steering for how the meeting should be folded in, e.g. "focus on the decisions, skip small talk"'
                          : 'A one-shot nudge for this run, e.g. "focus on the auth refactor"'
                    }
                    disabled={!canEdit || starting}
                    className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  />
                </div>
              )}

              {/* First ingest — stable-page seeding (greenfield only) */}
              {(isSynthesized || action === "full") && isGreenfield && (
                <div className="bg-emerald-950/20 px-4 py-3">
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

            {/* Run bar — the card's footer, not another floating box. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-muted/30 px-4 py-3">
              {isSynthesized ? (
                <>
                  <ViewOnlyTooltip viewOnly={!canEdit}>
                    <Button
                      onClick={() => void start()}
                      disabled={!canEdit || starting || compacting || inProgress || Boolean(reviewRun)}
                      title={
                        !canEdit
                          ? undefined
                          : reviewRun
                            ? "Resolve the pending draft review before starting a new run"
                            : inProgress
                              ? "An ingest and synthesis is already running"
                              : `Ingest sources and synthesize ${entityKind === "area" ? "Area" : "BHAG"}`
                      }
                    >
                      {starting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      {starting ? "Starting…" : "Ingest & synthesize"}
                    </Button>
                  </ViewOnlyTooltip>
                  <ViewOnlyTooltip viewOnly={!canEdit}>
                    <Button
                      variant="outline"
                      onClick={() => void compact()}
                      disabled={
                        !canEdit || starting || compacting || inProgress || isGreenfield || Boolean(reviewRun)
                      }
                      title={
                        !canEdit
                          ? undefined
                          : reviewRun
                            ? "Resolve the pending draft review before starting a new run"
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
                  </ViewOnlyTooltip>
                </>
              ) : (
                <ViewOnlyTooltip viewOnly={!canEdit}>
                  <Button
                    onClick={() => void (action === "compact" ? compact() : start())}
                    disabled={
                      !canEdit ||
                      starting ||
                      compacting ||
                      inProgress ||
                      Boolean(reviewRun) ||
                      (action === "meeting" && selectedMeetings.size === 0)
                    }
                    title={
                      !canEdit
                        ? undefined
                        : reviewRun
                          ? "Resolve the pending draft review before starting a new run"
                          : inProgress
                            ? "A run is already in progress"
                            : action === "meeting" && selectedMeetings.size === 0
                              ? "Select at least one meeting"
                              : action === "quick"
                                ? "Make one targeted correction without re-scouring every source"
                                : action === "compact"
                                  ? "Tighten the wiki's prose and fix stale links"
                                  : "Re-run the agent over every attached source"
                    }
                  >
                    {starting || compacting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : action === "compact" ? (
                      <Scissors className="h-4 w-4" />
                    ) : action === "quick" ? (
                      <Zap className="h-4 w-4" />
                    ) : action === "meeting" ? (
                      <Video className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {starting
                      ? "Starting…"
                      : compacting
                        ? "Compacting…"
                        : action === "quick"
                          ? "Run quick edit"
                          : action === "meeting"
                            ? "Ingest meeting"
                            : action === "compact"
                              ? "Compact"
                              : "Run ingest"}
                  </Button>
                </ViewOnlyTooltip>
              )}
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
                    {lastRun.reviewed_by && <ReviewerAvatar email={lastRun.reviewed_by} />}
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
            {error && (
              <p className="border-t bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
      </PanelShell>

      <RunsDialog
        open={runsOpen}
        onOpenChange={setRunsOpen}
        runs={runs ?? []}
        onOpenRun={onOpenRun}
        onViewChanges={onReviewDraft}
      />
    </>
  );
}
