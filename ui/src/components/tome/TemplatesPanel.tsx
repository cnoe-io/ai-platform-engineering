"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelShell } from "@/components/tome/PanelHeader";
import { ViewTemplatesDialog } from "@/components/tome/ViewTemplatesDialog";
import type { PageDrift } from "@/lib/tome/template-drift";
import { cn } from "@/lib/utils";

/**
 * "Check for template drift" (#508): its own tab, not folded into the
 * ingest panel.
 *
 * The page is organized around what a user actually does here, in order:
 * see what's wrong -> understand each problem -> fix it. Everything that's
 * fine recedes; the full page-by-page tree is opt-in, not the default view.
 *
 * Version (structural, free, always known) and content (only known once a
 * check runs) are different axes - a page can be on the current template
 * version and still have drifted content - but that distinction shows up
 * in each finding's own explanation, not as two badges on every row.
 */

interface Props {
  slug: string;
  onNavigate: (path: string) => void;
  onIngestStarted: (runId: string) => void;
}

const TOP_LEVEL_GROUP = "Top-level";

function isDrifted(p: PageDrift): boolean {
  return p.drifted === true;
}

function needsAttention(p: PageDrift): boolean {
  if (p.status === "missing") return true;
  if (isDrifted(p)) return true;
  // An unchecked old-version page still deserves a look; an unchecked
  // up-to-date page does not (nothing suggests it's a problem).
  return p.status === "version_behind" && p.drifted == null;
}

/** Why this specific page is in the attention list, in plain language -
 * the LLM's own drift explanation surfaces here, not three levels deep. */
function findingExplanation(p: PageDrift): string {
  if (p.status === "missing") {
    return "Its template expects this page, but nothing has created it yet.";
  }
  if (p.drifted === true) {
    return p.reason
      ? p.reason
      : "A content check found this page no longer matches its template's current guidance.";
  }
  // version_behind, not yet content-checked
  return "Bound to an older version of its template. Content hasn't been checked yet, so it may or may not still match.";
}

function groupOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? TOP_LEVEL_GROUP : path.slice(0, i);
}

function groupPages(pages: PageDrift[]): [string, PageDrift[]][] {
  const byGroup = new Map<string, PageDrift[]>();
  for (const p of pages) {
    const key = groupOf(p.path);
    const list = byGroup.get(key);
    if (list) list.push(p);
    else byGroup.set(key, [p]);
  }
  return [...byGroup.entries()].sort(([a], [b]) => {
    if (a === TOP_LEVEL_GROUP) return -1;
    if (b === TOP_LEVEL_GROUP) return 1;
    return a.localeCompare(b);
  });
}

/** "Not from a template" is a big, low-stakes bucket (glossaries, edge
 * files, anything hand-authored) - a breakdown line instead of a stat
 * card so it doesn't compete visually with what actually needs a look.
 * Grouped as top-level files vs. child pages (folder names are context,
 * not their own counted category - a wiki can have dozens of folders and
 * nobody needs each one tallied separately). */
function unboundSummary(pages: PageDrift[]): string | null {
  const unbound = pages.filter((p) => p.status === "unbound");
  if (unbound.length === 0) return null;
  const groups = groupPages(unbound);
  const topLevel = groups.find(([group]) => group === TOP_LEVEL_GROUP)?.[1] ?? [];
  const childGroups = groups.filter(([group]) => group !== TOP_LEVEL_GROUP);
  const childCount = childGroups.reduce((sum, [, group_pages]) => sum + group_pages.length, 0);

  const topLevelPart = topLevel.length > 0 ? `${topLevel.length} untemplated file${topLevel.length === 1 ? "" : "s"}` : null;
  const childPart =
    childCount > 0
      ? `${childCount} child page${childCount === 1 ? "" : "s"} (${childGroups.map(([group]) => group.slice(group.lastIndexOf("/") + 1)).join(", ")})`
      : null;

  const parts = [topLevelPart, childPart].filter((p): p is string => p != null);
  return `Also not from a template: ${parts.join(" and ")}.`;
}

async function fetchDrift(
  slug: string,
  contentCheck: boolean,
  contentCheckScope: "out_of_date" | "all_bound" = "out_of_date",
): Promise<PageDrift[]> {
  const res = await fetch(`/api/tome/projects/${slug}/template-drift`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentCheck, contentCheckScope }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `template drift check failed (${res.status})`);
  }
  return json.data.pages as PageDrift[];
}

type RunningTask =
  | { kind: "structural" }
  | { kind: "content"; total: number; checked: number; lastPath: string | null; liveText: string }
  | { kind: "fixing"; count: number };

// How much of the streamed text tail to keep on screen - just enough for a
// single truncated line, not a growing transcript.
const LIVE_TEXT_TAIL_CHARS = 200;

function RunningBanner({ task }: { task: RunningTask }) {
  const label =
    task.kind === "structural"
      ? "Rescanning page versions against templates..."
      : task.kind === "content"
        ? `Checking content: ${task.checked}/${task.total} page${task.total === 1 ? "" : "s"}${
            task.lastPath ? ` (just checked ${task.lastPath})` : ""
          }...`
        : `Fixing ${task.count} flagged page${task.count === 1 ? "" : "s"}...`;
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        <span className="truncate">{label}</span>
      </div>
      {task.kind === "content" && task.liveText && (
        <p className="mt-1 truncate pl-6 font-mono text-xs text-muted-foreground">
          {task.liveText}
        </p>
      )}
    </div>
  );
}

interface DriftStreamEvent {
  type: string;
  data: Record<string, unknown>;
}

function driftStreamEvent(frame: string): DriftStreamEvent | null {
  let type = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const data = JSON.parse(dataLines.join("\n")) as unknown;
  return data && typeof data === "object" && !Array.isArray(data)
    ? { type, data: data as Record<string, unknown> }
    : null;
}

async function consumeDriftStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: DriftStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      const event = driftStreamEvent(buffer.slice(0, separator));
      buffer = buffer.slice(separator + 2);
      if (event) onEvent(event);
      separator = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  const tail = driftStreamEvent(buffer);
  if (tail) onEvent(tail);
}

/** Skeleton shaped like the real layout below (stat cards, findings,
 * actions) instead of a generic row list - so the loading state doesn't
 * flash a different shape than what replaces it. */
function TemplatesPanelSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-1 items-center gap-2.5 rounded-lg border px-3 py-2.5">
            <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="space-y-1.5">
              <div className="h-5 w-6 animate-pulse rounded bg-muted" />
              <div className="h-3 w-16 animate-pulse rounded bg-muted/70" />
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-lg border px-3 py-2.5">
            <div className={cn("h-4 animate-pulse rounded bg-muted", i === 0 ? "w-1/3" : "w-1/4")} />
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted/70" />
          </div>
        ))}
      </div>
      <div className="h-14 animate-pulse rounded-lg border bg-muted/20" />
    </div>
  );
}

function StatCard({
  label,
  count,
  tone,
  icon,
}: {
  label: string;
  count: number;
  tone: "attention" | "neutral" | "good";
  icon: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 items-center gap-2.5 rounded-lg border px-3 py-2.5",
        tone === "attention" && count > 0
          ? "border-amber-500/30 bg-amber-950/20"
          : "border-border bg-muted/20",
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          tone === "attention" && count > 0
            ? "bg-amber-950/40 text-amber-400"
            : tone === "good"
              ? "bg-emerald-950/30 text-emerald-400"
              : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div>
        <div className="text-lg font-semibold leading-none">{count}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

export function TemplatesPanel({ slug, onNavigate, onIngestStarted }: Props) {
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState<RunningTask | null>(null);
  const [report, setReport] = useState<PageDrift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [templatesDialogOpen, setTemplatesDialogOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const checkStructural = useCallback(async () => {
    setChecking(true);
    setRunning({ kind: "structural" });
    setError(null);
    try {
      const structural = await fetchDrift(slug, false);
      setReport(structural);
      setCheckedAt(new Date());
      const quiet = groupPages(structural)
        .filter(([, pages]) => !pages.some(needsAttention))
        .map(([group]) => group);
      setCollapsedGroups(new Set(quiet));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setChecking(false);
      setRunning(null);
    }
  }, [slug]);

  useEffect(() => {
    void checkStructural();
  }, [checkStructural]);

  const liveTextRef = useRef("");

  const checkContent = useCallback(
    async (total: number) => {
      liveTextRef.current = "";
      setRunning({ kind: "content", total, checked: 0, lastPath: null, liveText: "" });
      setError(null);
      try {
        const res = await fetch(`/api/tome/projects/${slug}/template-drift/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentCheckScope: "all_bound" }),
        });
        if (!res.ok || !res.body) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json?.error || `content check failed (${res.status})`);
        }
        await consumeDriftStream(res.body, (event) => {
          if (event.type === "token") {
            const text = typeof event.data.text === "string" ? event.data.text : "";
            liveTextRef.current = (liveTextRef.current + text).slice(-LIVE_TEXT_TAIL_CHARS);
            setRunning((prev) =>
              prev?.kind === "content" ? { ...prev, liveText: liveTextRef.current } : prev,
            );
          } else if (event.type === "progress") {
            const checked = Number(event.data.checked) || 0;
            const evtTotal = Number(event.data.total) || total;
            setRunning({
              kind: "content",
              total: evtTotal,
              checked,
              lastPath: typeof event.data.path === "string" ? event.data.path : null,
              liveText: liveTextRef.current,
            });
            // Reflect this page's verdict immediately, before the final
            // `done` event - a 22-page check should feel like it's making
            // progress, not stay frozen until the very end.
            setReport((prev) =>
              prev?.map((p) =>
                p.path === event.data.path
                  ? { ...p, drifted: event.data.drifted as boolean | null, reason: event.data.reason as string | null }
                  : p,
              ) ?? prev,
            );
          } else if (event.type === "done") {
            const pages = event.data.pages as PageDrift[] | undefined;
            if (pages) setReport(pages);
            setCheckedAt(new Date());
          }
        });
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        setRunning(null);
      }
    },
    [slug],
  );

  const resolve = useCallback(async (count: number) => {
    if (!report) return;
    setRunning({ kind: "fixing", count });
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/template-drift/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || `fix failed (${res.status})`);
      }
      if (json.data.runId) onIngestStarted(json.data.runId as string);
      else void checkStructural(); // nothing needed an ingest; just refresh
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setRunning(null);
    }
  }, [slug, report, onIngestStarted, checkStructural]);

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const attention = useMemo(() => report?.filter(needsAttention) ?? [], [report]);
  const current = useMemo(() => report?.filter((p) => p.status === "current").length ?? 0, [report]);
  const unboundLine = useMemo(() => unboundSummary(report ?? []), [report]);
  const boundUnchecked = useMemo(
    () =>
      report?.filter(
        (p) => (p.status === "version_behind" || p.status === "current") && p.drifted == null,
      ) ?? [],
    [report],
  );
  const groups = useMemo(() => groupPages(report ?? []), [report]);

  const busy = checking || running != null;

  return (
    <PanelShell
      title="Template drift"
      description="See which wiki pages are missing, on an old template version, or no longer match their template's guidance."
    >
      <ViewTemplatesDialog open={templatesDialogOpen} onOpenChange={setTemplatesDialogOpen} />
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {checking && !report ? (
        <TemplatesPanelSkeleton />
      ) : (
        report && (
          <div className="space-y-4">
            {running && <RunningBanner task={running} />}

            {/* Status, at a glance - no reading required. */}
            <div className="flex flex-wrap gap-2">
              <StatCard
                label="need attention"
                count={attention.length}
                tone="attention"
                icon={<AlertTriangle className="h-3.5 w-3.5" />}
              />
              <StatCard
                label="up to date"
                count={current}
                tone="good"
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              />
            </div>
            {unboundLine && <p className="text-xs text-muted-foreground">{unboundLine}</p>}
            {checkedAt && (
              <p className="text-xs text-muted-foreground">
                Last checked {checkedAt.toLocaleTimeString()}.
              </p>
            )}

            {/* The actual work: what's wrong, explained, one card each. */}
            {attention.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-950/10 px-3 py-3 text-sm text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Nothing needs attention right now.
              </div>
            ) : (
              <ul className="space-y-2">
                {attention.map((p) => (
                  <li
                    key={p.path}
                    className="rounded-lg border border-amber-500/20 bg-amber-950/10 px-3 py-2.5 text-sm"
                  >
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      {p.status === "missing" ? (
                        <span className="font-mono font-medium">{p.path}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onNavigate(p.path)}
                          className="font-mono font-medium hover:underline"
                        >
                          {p.path}
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-muted-foreground">{findingExplanation(p)}</p>
                  </li>
                ))}
              </ul>
            )}

            {/* Actions: named for what happens, with the cost spelled out
                so nobody clicks "Check" without knowing what it does. */}
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <p className="text-xs font-medium text-muted-foreground">Actions</p>

              {boundUnchecked.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {`Ask AI to compare ${boundUnchecked.length} template-bound page${boundUnchecked.length === 1 ? "" : "s"} against their template's current guidance. Content can drift even on a page that's on the current version.`}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void checkContent(boundUnchecked.length)}
                    disabled={busy}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Check content
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {attention.length > 0
                    ? `Create missing pages and re-ingest anything flagged above (${attention.length} page${attention.length === 1 ? "" : "s"}) so it matches its template.`
                    : "Rescan page versions against templates. Free, no AI involved."}
                </p>
                {attention.length > 0 ? (
                  <Button size="sm" onClick={() => void resolve(attention.length)} disabled={busy}>
                    <Wrench className="h-3.5 w-3.5" />
                    Fix flagged pages
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => void checkStructural()} disabled={busy}>
                    <Wrench className="h-3.5 w-3.5" />
                    Rescan
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                <p className="text-sm text-muted-foreground">
                  See the current page-template config every page above is checked against.
                </p>
                <Button size="sm" variant="ghost" onClick={() => setTemplatesDialogOpen(true)}>
                  <BookOpen className="h-3.5 w-3.5" />
                  View current templates
                </Button>
              </div>
            </div>

            {/* Everything else - opt-in, not part of the health-check flow. */}
            <div className="rounded-lg border">
              <button
                type="button"
                onClick={() => setBrowseOpen((v) => !v)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-muted/40"
              >
                {browseOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Browse all {report.length} template-related pages
              </button>
              {browseOpen && (
                <div className="divide-y border-t">
                  {groups.map(([group, pages]) => {
                    const collapsed = collapsedGroups.has(group);
                    return (
                      <div key={group}>
                        <button
                          type="button"
                          onClick={() => toggleGroup(group)}
                          className="flex w-full items-center gap-1.5 bg-muted/20 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted/40"
                        >
                          {collapsed ? (
                            <ChevronRight className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                          <span className="font-mono">{group}</span>
                          <span>({pages.length})</span>
                        </button>
                        {!collapsed && (
                          <ul className="divide-y">
                            {pages.map((p) => (
                              <li key={p.path} className="flex items-start gap-1.5 px-3 py-2 text-sm">
                                <Badge
                                  variant="outline"
                                  className="mt-0.5 shrink-0 text-[11px] font-medium normal-case"
                                >
                                  {p.status === "missing"
                                    ? "Missing"
                                    : p.status === "unbound"
                                      ? "Not from a template"
                                      : p.status === "version_behind"
                                        ? p.drifted === true
                                          ? "Old version, drifted"
                                          : "Old version"
                                        : p.drifted === true
                                          ? "Drifted"
                                          : "Up to date"}
                                </Badge>
                                <span className="flex-1">
                                  {p.status === "missing" ? (
                                    <span className="font-mono text-muted-foreground">{p.path}</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => onNavigate(p.path)}
                                      className="font-mono hover:underline"
                                    >
                                      {p.path}
                                    </button>
                                  )}
                                  {p.reason && (
                                    <span className="ml-1.5 text-xs text-muted-foreground">
                                      : {p.reason}
                                    </span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )
      )}
    </PanelShell>
  );
}
