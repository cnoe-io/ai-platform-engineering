"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, ShieldQuestion, Wand2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelShell } from "@/components/tome/PanelHeader";
import { TomeLoading } from "@/components/tome/TomeLoading";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PageDrift, PageDriftStatus } from "@/lib/tome/template-drift";
import { cn } from "@/lib/utils";

/**
 * "Check for template drift" (#508): its own tab, not folded into the
 * ingest panel.
 *
 * Two independent axes, never collapsed into one label:
 * - version (structural, free, always known): missing / not from a
 *   template / old version / up to date.
 * - content (only known once a check runs): not checked / content ok /
 *   drifted. A page can be up to date AND drifted — version staleness
 *   doesn't catch every way content can diverge from template guidance.
 *
 * The structural pass runs automatically on open (free, no LLM); content
 * checks are explicit, separate actions since they're real model calls.
 * "Resolve" (#487) only ever acts on the report currently on screen.
 */

interface Props {
  slug: string;
  onNavigate: (path: string) => void;
  onIngestStarted: (runId: string) => void;
}

const TOP_LEVEL_GROUP = "Top-level";

type FilterKey = "all" | "attention" | PageDriftStatus | "drifted";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "missing", label: "Missing" },
  { key: "version_behind", label: "Old version" },
  { key: "drifted", label: "Drifted" },
  { key: "unbound", label: "Not from a template" },
  { key: "current", label: "Up to date" },
];

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

const VERSION_BADGE: Record<
  PageDriftStatus,
  { label: string; className: string; tooltip: string }
> = {
  missing: {
    label: "Missing",
    className: "bg-destructive/10 text-destructive border-transparent",
    tooltip: "This page doesn't exist yet. The page template expects it, but nothing has created it.",
  },
  unbound: {
    label: "Not from a template",
    className: "bg-muted text-muted-foreground border-transparent",
    tooltip:
      "This page isn't seeded from a page template: either a manual addition, or it predates template binding and hasn't been re-ingested since.",
  },
  version_behind: {
    label: "Old version",
    className: "bg-amber-950/30 text-amber-400 border-transparent",
    tooltip: "This page was bound to an older version of its template. The template has since been edited.",
  },
  current: {
    label: "Up to date",
    className: "bg-emerald-950/30 text-emerald-400 border-transparent",
    tooltip: "This page is bound to the template's current version.",
  },
};

function contentBadge(
  p: PageDrift,
  pending: boolean,
): { label: string; className: string; tooltip: string } | null {
  if (pending) {
    return {
      label: "checking",
      className: "bg-muted text-muted-foreground border-transparent",
      tooltip: "Checking this page's body against its template's current guidance.",
    };
  }
  if (p.status === "missing" || p.status === "unbound") return null;
  if (p.drifted === true) {
    return {
      label: "Drifted",
      className: "bg-amber-950/30 text-amber-400 border-transparent",
      tooltip:
        "A content check found this page's body no longer satisfies its template's current guidance, independent of whether its version is up to date.",
    };
  }
  if (p.drifted === false) {
    return {
      label: "Content ok",
      className: "bg-emerald-950/30 text-emerald-400 border-transparent",
      tooltip: "A content check confirmed this page's body still satisfies its template's current guidance.",
    };
  }
  return {
    label: "Not checked",
    className: "bg-muted/50 text-muted-foreground/70 border-dashed",
    tooltip:
      "Content hasn't been checked yet. Being up to date on version doesn't guarantee the content itself still matches; run a content check to find out.",
  };
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

export function TemplatesPanel({ slug, onNavigate, onIngestStarted }: Props) {
  const [checking, setChecking] = useState(false);
  const [checkingContent, setCheckingContent] = useState(false);
  const [contentCheckScope, setContentCheckScope] = useState<"out_of_date" | "all_bound" | null>(
    null,
  );
  const [resolving, setResolving] = useState(false);
  const [report, setReport] = useState<PageDrift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState<FilterKey>("attention");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const checkStructural = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const structural = await fetchDrift(slug, false);
      setReport(structural);
      setCheckedAt(new Date());
      // Open only the groups that need a look; collapse the rest (e.g. a
      // wiki with 40 glossary entries shouldn't dump all of them on screen).
      const quiet = groupPages(structural)
        .filter(([, pages]) => !pages.some(needsAttention))
        .map(([group]) => group);
      setCollapsedGroups(new Set(quiet));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setChecking(false);
    }
  }, [slug]);

  useEffect(() => {
    void checkStructural();
  }, [checkStructural]);

  const checkContent = useCallback(
    async (scope: "out_of_date" | "all_bound") => {
      setCheckingContent(true);
      setContentCheckScope(scope);
      setError(null);
      try {
        const full = await fetchDrift(slug, true, scope);
        setReport(full);
        setCheckedAt(new Date());
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        setCheckingContent(false);
        setContentCheckScope(null);
      }
    },
    [slug],
  );

  const resolve = useCallback(async () => {
    if (!report) return;
    setResolving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/template-drift/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || `resolve failed (${res.status})`);
      }
      if (json.data.runId) onIngestStarted(json.data.runId as string);
      else void checkStructural(); // nothing needed an ingest; just refresh
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setResolving(false);
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

  const oldVersionUnchecked =
    report?.filter((p) => p.status === "version_behind" && p.drifted == null) ?? [];
  const boundUnchecked =
    report?.filter(
      (p) => (p.status === "version_behind" || p.status === "current") && p.drifted == null,
    ) ?? [];
  const attention = report?.filter(needsAttention) ?? [];
  const visible = useMemo(() => {
    if (!report) return [];
    if (filter === "all") return report;
    if (filter === "attention") return report.filter(needsAttention);
    if (filter === "drifted") return report.filter(isDrifted);
    return report.filter((p) => p.status === filter);
  }, [report, filter]);
  const groups = useMemo(() => groupPages(visible), [visible]);

  return (
    <PanelShell
      title="Template drift"
      description="See which wiki pages are missing, on an old template version, or no longer match their template's guidance."
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      {checking && !report ? (
        <TomeLoading variant="list" rows={4} />
      ) : (
        report && (
          <div className="space-y-3">
            {/* Status + actions live together as their own row, separate
                from the panel title. */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-sm text-muted-foreground">
                {checkedAt && `Checked ${checkedAt.toLocaleTimeString()}. `}
                {report.length} template-related page{report.length === 1 ? "" : "s"},{" "}
                {attention.length} need attention.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {oldVersionUnchecked.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void checkContent("out_of_date")}
                    disabled={checkingContent || checking}
                  >
                    {checkingContent && contentCheckScope === "out_of_date" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldQuestion className="h-3.5 w-3.5" />
                    )}
                    Check {oldVersionUnchecked.length} old-version page
                    {oldVersionUnchecked.length === 1 ? "" : "s"}
                  </Button>
                )}
                {boundUnchecked.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void checkContent("all_bound")}
                    disabled={checkingContent || checking}
                  >
                    {checkingContent && contentCheckScope === "all_bound" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldQuestion className="h-3.5 w-3.5" />
                    )}
                    Check all {boundUnchecked.length} templated page{boundUnchecked.length === 1 ? "" : "s"}
                  </Button>
                )}
                {attention.length > 0 && (
                  <Button size="sm" onClick={() => void resolve()} disabled={resolving}>
                    {resolving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="h-3.5 w-3.5" />
                    )}
                    Resolve
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void checkStructural()}
                  disabled={checking}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
                  Recheck
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {FILTERS.map((f) => {
                const count =
                  f.key === "all"
                    ? report.length
                    : f.key === "attention"
                      ? attention.length
                      : f.key === "drifted"
                        ? report.filter(isDrifted).length
                        : report.filter((p) => p.status === f.key).length;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                      filter === f.key
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70",
                    )}
                  >
                    {f.label}
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-4 min-w-4 justify-center px-1 text-[10px] leading-none",
                        filter === f.key ? "border-primary-foreground/40" : "border-transparent bg-background/60",
                      )}
                    >
                      {count}
                    </Badge>
                  </button>
                );
              })}
            </div>

            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in this filter.</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {groups.map(([group, pages]) => {
                  const collapsed = collapsedGroups.has(group);
                  const groupAttention = pages.filter(needsAttention).length;
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
                        {groupAttention > 0 && (
                          <span className="ml-1 rounded-full bg-amber-950/30 px-1.5 py-0.5 text-[10px] text-amber-400">
                            {groupAttention} need attention
                          </span>
                        )}
                      </button>
                      {!collapsed && (
                        <ul className="divide-y">
                          {pages.map((p) => {
                            const pending =
                              checkingContent &&
                              p.drifted == null &&
                              (p.status === "version_behind" ||
                                (p.status === "current" && contentCheckScope === "all_bound"));
                            const cBadge = contentBadge(p, pending);
                            return (
                              <li key={p.path} className="flex items-start gap-1.5 px-3 py-2 text-sm">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      className={cn(
                                        "mt-0.5 shrink-0 cursor-default text-[11px] font-medium normal-case",
                                        VERSION_BADGE[p.status].className,
                                      )}
                                    >
                                      {VERSION_BADGE[p.status].label}
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="max-w-64 whitespace-normal text-xs">
                                    {VERSION_BADGE[p.status].tooltip}
                                  </TooltipContent>
                                </Tooltip>
                                {cBadge && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge
                                        className={cn(
                                          "mt-0.5 flex shrink-0 items-center gap-1 cursor-default text-[11px] font-medium normal-case",
                                          cBadge.className,
                                        )}
                                      >
                                        {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                                        {cBadge.label}
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="max-w-64 whitespace-normal text-xs">
                                      {cBadge.tooltip}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
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
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )
      )}
    </PanelShell>
  );
}
