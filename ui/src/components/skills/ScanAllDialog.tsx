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

type Scope = "custom" | "hub" | "builtin" | "all";

interface BulkResultRow {
  id: string;
  source: "agent_skills" | "hub" | "builtin";
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
  { v: "all", l: "All", hint: "Custom + hub-cached + built-in templates" },
  { v: "custom", l: "Custom only", hint: "Skills authored in this workspace" },
  { v: "hub", l: "Hubs only", hint: "Imported / crawled hub skills" },
  {
    v: "builtin",
    l: "Built-ins only",
    hint: "Packaged templates from SKILLS_DIR (read-only on disk)",
  },
];

function sourceLabel(source: BulkResultRow["source"]): string {
  switch (source) {
    case "agent_skills":
      return "Custom";
    case "hub":
      return "Hub";
    case "builtin":
      return "Built-in";
  }
}

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

  // Live-progress state populated by the NDJSON stream. We render the
  // progress card when `liveTotal > 0` (after the `start` event) and
  // hide it once `result` lands. `liveRows` accumulates per-row events
  // so the operator sees skills flip to passed/flagged/unscanned in
  // real time instead of waiting for the whole sweep to finish.
  const [liveTotal, setLiveTotal] = useState(0);
  const [liveRows, setLiveRows] = useState<BulkResultRow[]>([]);

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
    setLiveRows([]);
    setLiveTotal(0);
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
    setLiveRows([]);
    setLiveTotal(0);
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
        headers: {
          "Content-Type": "application/json",
          // Opt into the route's NDJSON streaming path so we get
          // start / row / complete events instead of one big JSON
          // dump after the whole sweep finishes. Server falls back to
          // aggregate JSON for clients that don't send this header.
          Accept: "application/x-ndjson",
        },
        credentials: "include",
        body: JSON.stringify({ scope, ...(hubIds ? { hub_ids: hubIds } : {}) }),
      });

      if (!res.ok) {
        // Errors from the route stay JSON (auth/validation) so we can
        // surface a useful message instead of a half-empty stream.
        let message = `Request failed (${res.status})`;
        try {
          const data = await res.json();
          message = data?.error || data?.message || message;
        } catch {
          /* fall through */
        }
        throw new Error(message);
      }

      const ct = res.headers.get("Content-Type") ?? "";
      if (ct.includes("application/x-ndjson") && res.body) {
        // Stream path: parse newline-delimited JSON events as they
        // arrive. Each `row` event flips a skill in the live list and
        // bumps the progress bar; `complete` carries the same summary
        // shape the legacy JSON path returned.
        await consumeNdjsonStream(res.body, {
          onStart: (total) => setLiveTotal(total),
          onRow: (row) => setLiveRows((prev) => [...prev, row]),
          onComplete: (summary) => setResult(summary),
        });
      } else {
        // Legacy / non-streaming path (e.g. older server). Still works.
        const data = await res.json();
        setResult((data?.data ?? data) as BulkResponse);
      }
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [scope, hubs, selectedHubIds, onComplete]);

  // Live counts derived from the streamed rows. Reused for the
  // in-progress progress bar + summary line so the operator doesn't
  // have to wait for `complete` to know how the sweep is trending.
  const liveCounts = useMemo(() => {
    const c = { passed: 0, flagged: 0, unscanned: 0 };
    for (const r of liveRows) c[r.scan_status] += 1;
    return c;
  }, [liveRows]);
  const livePct = liveTotal > 0
    ? Math.min(100, Math.round((liveRows.length / liveTotal) * 100))
    : 0;

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

        {!result && !running && (
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

        {!result && running && liveTotal > 0 && (
          <div className="space-y-3" data-testid="scan-all-progress">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Scanning skill {Math.min(liveRows.length + 1, liveTotal)}{" "}
                  of {liveTotal}…
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {livePct}%
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={livePct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Scan progress"
              >
                <div
                  className="h-full bg-primary transition-all duration-150"
                  style={{ width: `${livePct}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />{" "}
                  {liveCounts.passed}
                </span>
                <span className="inline-flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3 text-amber-600" />{" "}
                  {liveCounts.flagged}
                </span>
                <span className="inline-flex items-center gap-1">
                  <ShieldQuestion className="h-3 w-3" /> {liveCounts.unscanned}
                </span>
              </div>
            </div>

            {liveRows.length > 0 && (
              <div className="max-h-72 overflow-y-auto rounded-md border border-border/60 divide-y divide-border/60">
                {/* Newest first so the just-completed skill is always at the top */}
                {[...liveRows].reverse().map((row) => (
                  <div
                    key={`${row.source}-${row.id}`}
                    className="flex items-start gap-3 px-3 py-2 text-xs"
                  >
                    <StatusIcon status={row.scan_status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{row.name}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          {sourceLabel(row.source)}
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
                        {sourceLabel(row.source)}
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

        {!result && !running && noHubsSelected && (
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

/**
 * NDJSON stream events emitted by `POST /api/skills/scan-all` when the
 * client sends `Accept: application/x-ndjson`. Mirror of the server's
 * `StreamEvent` type — kept inline here to avoid importing server-only
 * route code into a client component.
 */
type ScanStreamEvent =
  | { type: "start"; scope: Scope; total_planned: number }
  | { type: "row"; row: BulkResultRow; index: number }
  | { type: "complete"; summary: BulkResponse };

interface StreamHandlers {
  onStart: (totalPlanned: number) => void;
  onRow: (row: BulkResultRow) => void;
  onComplete: (summary: BulkResponse) => void;
}

/**
 * Drain a NDJSON-streaming Response body and dispatch each event to
 * the matching handler. Tolerates partial lines across chunks (the
 * common case when many rows arrive faster than the network flushes).
 */
async function consumeNdjsonStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const evt = JSON.parse(line) as ScanStreamEvent;
        if (evt.type === "start") handlers.onStart(evt.total_planned);
        else if (evt.type === "row") handlers.onRow(evt.row);
        else if (evt.type === "complete") handlers.onComplete(evt.summary);
      } catch {
        // Don't crash the dialog if the server emits a malformed line —
        // worst case we miss one row's UI update; the persisted state
        // is already correct since the server writes Mongo before
        // emitting.
      }
    }
  }
  // Flush any trailing line that didn't end with \n.
  if (buf.trim()) {
    try {
      const evt = JSON.parse(buf.trim()) as ScanStreamEvent;
      if (evt.type === "complete") handlers.onComplete(evt.summary);
    } catch {
      /* swallow */
    }
  }
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
