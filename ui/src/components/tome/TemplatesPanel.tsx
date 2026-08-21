"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileQuestion,
  Loader2,
  Sparkles,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelShell } from "@/components/tome/PanelHeader";
import { TomeLoading } from "@/components/tome/TomeLoading";
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
  | { kind: "content"; scope: "out_of_date" | "all_bound"; count: number }
  | { kind: "fixing"; count: number };

function RunningBanner({ task }: { task: RunningTask }) {
  const label =
    task.kind === "structural"
      ? "Rescanning page versions against templates..."
      : task.kind === "content"
        ? `Checking content on ${task.count} page${task.count === 1 ? "" : "s"} against ${task.scope === "all_bound" ? "their" : "its"} template's guidance...`
        : `Fixing ${task.count} flagged page${task.count === 1 ? "" : "s"}...`;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
      <span>{label}</span>
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

  const checkContent = useCallback(
    async (scope: "out_of_date" | "all_bound", count: number) => {
      setRunning({ kind: "content", scope, count });
      setError(null);
      try {
        const full = await fetchDrift(slug, true, scope);
        setReport(full);
        setCheckedAt(new Date());
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
  const unbound = useMemo(() => report?.filter((p) => p.status === "unbound").length ?? 0, [report]);
  const current = useMemo(() => report?.filter((p) => p.status === "current").length ?? 0, [report]);
  const oldVersionUnchecked = useMemo(
    () => report?.filter((p) => p.status === "version_behind" && p.drifted == null) ?? [],
    [report],
  );
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
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {checking && !report ? (
        <TomeLoading variant="list" rows={4} />
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
                label="not from a template"
                count={unbound}
                tone="neutral"
                icon={<FileQuestion className="h-3.5 w-3.5" />}
              />
              <StatCard
                label="up to date"
                count={current}
                tone="good"
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              />
            </div>
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

              {oldVersionUnchecked.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    Ask AI to compare {oldVersionUnchecked.length} old-version page
                    {oldVersionUnchecked.length === 1 ? "" : "s"} against current template guidance.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void checkContent("out_of_date", oldVersionUnchecked.length)}
                    disabled={busy}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Check content
                  </Button>
                </div>
              )}

              {boundUnchecked.length > oldVersionUnchecked.length && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    Same check, but also covers pages already on the current version
                    (content can drift even without a version change) &mdash; {boundUnchecked.length} page
                    {boundUnchecked.length === 1 ? "" : "s"} total.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void checkContent("all_bound", boundUnchecked.length)}
                    disabled={busy}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Check everything
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
