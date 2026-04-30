"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  ShieldQuestion,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ScanStatus } from "@/types/agent-skill";

type Scope = "custom" | "hub" | "all";

interface BulkResultRow {
  id: string;
  source: "agent_skills" | "hub";
  name: string;
  scan_status: ScanStatus;
  scan_summary?: string;
  error?: string;
  duration_ms: number;
}

interface BulkResponse {
  scope: Scope;
  total: number;
  scanned: number;
  skipped: number;
  duration_ms: number;
  counts: Record<ScanStatus, number>;
  results: BulkResultRow[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired once after a successful sweep so the parent can refresh state. */
  onComplete?: () => void;
  /**
   * Pre-select the scope when the dialog opens. Used by the per-hub
   * "Scan now" nudge so the operator lands on Hubs-only with the
   * relevant hub already checked.
   */
  initialScope?: Scope;
  /**
   * Pre-select these hub ids (only meaningful when scope=hub). Bypasses
   * the default "select every enabled hub" behaviour.
   */
  initialHubIds?: string[];
}

const SCOPE_OPTIONS: Array<{ v: Scope; l: string; hint: string }> = [
  { v: "all", l: "All", hint: "Custom + hub-cached skills" },
  { v: "custom", l: "Custom only", hint: "Skills authored in this workspace" },
  { v: "hub", l: "Hubs only", hint: "Imported / crawled hub skills" },
];

/**
 * Admin-only "Scan all skills" modal. Posts to `/api/skills/scan-all`
 * (which is itself admin-gated) and renders the per-skill outcome
 * inline so the operator can see what flipped to flagged without
 * leaving the page.
 *
 * The sweep is intentionally synchronous — the standalone scanner runs
 * each skill in ~0.4s statically; even a 200-skill catalog finishes
 * inside the default fetch timeout. If we ever scan thousands, we'll
 * switch to the scanner's `/scan-batch` async endpoint and poll.
 */
interface HubOption {
  id: string;
  type: "github" | "gitlab";
  location: string;
  enabled: boolean;
  skills_count: number;
}

export function ScanAllDialog({
  open,
  onOpenChange,
  onComplete,
  initialScope,
  initialHubIds,
}: Props) {
  const [scope, setScope] = useState<Scope>(initialScope ?? "all");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BulkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hub picker state — only fetched when scope=hub. We default to
  // "all hubs selected" so untouched scope=hub behaves like before.
  const [hubs, setHubs] = useState<HubOption[] | null>(null);
  const [hubsLoading, setHubsLoading] = useState(false);
  const [hubsError, setHubsError] = useState<string | null>(null);
  const [selectedHubIds, setSelectedHubIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hubsInitialised, setHubsInitialised] = useState(false);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setRunning(false);
  }, []);

  // When the dialog (re)opens, honour the caller-provided initial scope /
  // hub preselection. This lets the per-hub nudge land on "Hubs only"
  // with just that hub checked instead of the default "all".
  useEffect(() => {
    if (!open) return;
    if (initialScope) setScope(initialScope);
    if (initialHubIds && initialHubIds.length > 0) {
      setSelectedHubIds(new Set(initialHubIds));
      // Mark as initialised so the lazy-fetch effect doesn't overwrite
      // the preselection with "every enabled hub" once the list loads.
      setHubsInitialised(true);
    }
    // We intentionally only re-run when the dialog opens; props changing
    // mid-session shouldn't yank state out from under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lazily fetch hubs the first time the user picks scope=hub. Cached
  // for the lifetime of this dialog instance so flipping scope back and
  // forth doesn't refetch. Pre-selects every enabled hub on first load.
  //
  // NOTE: do NOT include `hubsLoading` in the deps. We flip it to `true`
  // synchronously here, which would otherwise re-fire the effect, run
  // its cleanup (`cancelled = true`), and orphan the in-flight fetch —
  // leaving the UI stuck on "Loading hubs…" forever.
  useEffect(() => {
    if (scope !== "hub" || hubs !== null) return;
    let cancelled = false;
    setHubsLoading(true);
    setHubsError(null);
    fetch("/api/skill-hubs", { credentials: "include" })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(
            data?.message || data?.error || `Failed to load hubs (${r.status})`,
          );
        }
        return (data?.hubs ?? []) as HubOption[];
      })
      .then((list) => {
        if (cancelled) return;
        setHubs(list);
        if (!hubsInitialised) {
          setSelectedHubIds(
            new Set(list.filter((h) => h.enabled).map((h) => h.id)),
          );
          setHubsInitialised(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setHubsError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setHubsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, hubs]);

  const allHubsSelected = useMemo(
    () => Boolean(hubs && hubs.length > 0 && selectedHubIds.size === hubs.length),
    [hubs, selectedHubIds],
  );
  const noHubsSelected = scope === "hub" && (hubs?.length ?? 0) > 0 && selectedHubIds.size === 0;

  const toggleHub = useCallback((id: string) => {
    setSelectedHubIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectAllHubs = useCallback(() => {
    if (hubs) setSelectedHubIds(new Set(hubs.map((h) => h.id)));
  }, [hubs]);
  const clearHubs = useCallback(() => setSelectedHubIds(new Set()), []);

  const handleClose = useCallback(
    (next: boolean) => {
      if (!next && running) return; // block close while in flight
      onOpenChange(next);
      if (!next) reset();
    },
    [onOpenChange, reset, running],
  );

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      // Only forward hub_ids when scope=hub AND the user narrowed the
      // selection. Sending an empty array when the user picked "all hubs"
      // is fine but slightly chattier — omit it to keep the request lean.
      const hubIds =
        scope === "hub" && hubs && selectedHubIds.size < hubs.length
          ? Array.from(selectedHubIds)
          : undefined;
      const res = await fetch("/api/skills/scan-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scope, ...(hubIds ? { hub_ids: hubIds } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error || data?.message || `Request failed (${res.status})`,
        );
      }
      setResult((data?.data ?? data) as BulkResponse);
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [scope, hubs, selectedHubIds, onComplete]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Scan all skills
          </DialogTitle>
          <DialogDescription>
            Re-runs the security scanner against every skill in scope and
            updates each skill&apos;s recorded status. Each scan is
            recorded in the audit log below as <code>bulk_*</code>.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="space-y-3" data-testid="scan-all-form">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Scope</legend>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {SCOPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.v}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-md border px-3 py-2 cursor-pointer text-sm",
                      scope === opt.v
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:border-border",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="scope"
                        value={opt.v}
                        checked={scope === opt.v}
                        onChange={() => setScope(opt.v)}
                        className="accent-primary"
                      />
                      <span className="font-medium">{opt.l}</span>
                    </div>
                    <span className="text-xs text-muted-foreground pl-5">
                      {opt.hint}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {scope === "hub" && (
              <fieldset
                className="space-y-2"
                data-testid="scan-all-hub-picker"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <legend className="text-sm font-medium">Hubs</legend>
                    {hubs && hubs.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {selectedHubIds.size} of {hubs.length} selected
                      </span>
                    )}
                  </div>
                  {hubs && hubs.length > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={selectAllHubs}
                        disabled={allHubsSelected}
                        className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                      >
                        Select all
                      </button>
                      <span className="text-muted-foreground">·</span>
                      <button
                        type="button"
                        onClick={clearHubs}
                        disabled={selectedHubIds.size === 0}
                        className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                {hubsLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading hubs…
                  </div>
                )}

                {hubsError && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {hubsError}
                  </div>
                )}

                {!hubsLoading && hubs && hubs.length === 0 && (
                  <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    No hubs registered. Add one in Admin → Skill Hubs.
                  </div>
                )}

                {hubs && hubs.length > 0 && (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 divide-y divide-border/60">
                    {hubs.map((hub) => {
                      const checked = selectedHubIds.has(hub.id);
                      return (
                        <label
                          key={hub.id}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 cursor-pointer text-xs",
                            checked ? "bg-primary/5" : "hover:bg-muted/30",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleHub(hub.id)}
                            className="accent-primary h-3.5 w-3.5"
                            data-testid={`scan-all-hub-${hub.id}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">
                                {hub.location}
                              </span>
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1 py-0"
                              >
                                {hub.type}
                              </Badge>
                              {!hub.enabled && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1 py-0 text-muted-foreground"
                                >
                                  disabled
                                </Badge>
                              )}
                            </div>
                          </div>
                          <span className="text-muted-foreground tabular-nums">
                            {hub.skills_count} skill
                            {hub.skills_count === 1 ? "" : "s"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            )}

            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="space-y-3" data-testid="scan-all-result">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Passed:{" "}
                {result.counts.passed ?? 0}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <ShieldAlert className="h-3 w-3 text-amber-600" /> Flagged:{" "}
                {result.counts.flagged ?? 0}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <ShieldQuestion className="h-3 w-3 text-muted-foreground" />{" "}
                Unscanned: {result.counts.unscanned ?? 0}
              </Badge>
              <span className="text-muted-foreground">
                · {result.scanned} scanned, {result.skipped} skipped in{" "}
                {(result.duration_ms / 1000).toFixed(1)}s
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border border-border/60 divide-y divide-border/60">
              {result.results.length === 0 && (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                  No skills matched the selected scope.
                </div>
              )}
              {result.results.map((row) => (
                <div
                  key={`${row.source}-${row.id}`}
                  className="flex items-start gap-3 px-3 py-2 text-xs"
                >
                  <StatusIcon status={row.scan_status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{row.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        {row.source === "agent_skills" ? "Custom" : "Hub"}
                      </Badge>
                    </div>
                    {(row.scan_summary || row.error) && (
                      <div
                        className={cn(
                          "mt-0.5 line-clamp-2",
                          row.error
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                        title={row.error || row.scan_summary}
                      >
                        {row.error || row.scan_summary}
                      </div>
                    )}
                  </div>
                  <span className="text-muted-foreground tabular-nums">
                    {row.duration_ms ? `${row.duration_ms}ms` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!result && noHubsSelected && (
          <p className="text-xs text-amber-600 dark:text-amber-400 -mt-2">
            Select at least one hub, or switch scope to <strong>All</strong> /{" "}
            <strong>Custom only</strong>.
          </p>
        )}
        <DialogFooter>
          {!result ? (
            <>
              <Button
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={running}
              >
                Cancel
              </Button>
              <Button
                onClick={run}
                disabled={running || hubsLoading || noHubsSelected}
                className="gap-2"
              >
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                {running ? "Scanning…" : "Start scan"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={reset}>
                Run another
              </Button>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusIcon({ status }: { status: ScanStatus }) {
  if (status === "passed") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />;
  }
  if (status === "flagged") {
    return <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5" />;
  }
  return <ShieldQuestion className="h-4 w-4 text-muted-foreground mt-0.5" />;
}
