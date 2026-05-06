"use client";

/**
 * ScanTab — the consolidated "Scan skill" surface.
 *
 * The previous build exposed scan history on its own tab without any
 * way to actually trigger a scan from inside the workspace, which
 * confused first-time builders ("why am I looking at history if I've
 * never scanned?"). This component fixes that by leading with a clear
 * call-to-action — Scan now — and demoting the audit trail to a
 * collapsible section underneath. The latest result lives in a banner
 * between the two so users immediately see "did the last scan pass?".
 *
 * Wiring:
 *   - "Scan now" → POST /api/skills/configs/[id]/scan
 *     (or the hub-scan endpoint for `catalog-hub-*` rows)
 *   - History  → GET  /api/skills/scan-history?skill_id=<id>
 *
 * Hub / built-in skills are always scannable (manual scan persists
 * back to the hub cache doc); writability of the skill itself is
 * irrelevant to scanning.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  History as HistoryIcon,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface ScanEvent {
  id: string;
  ts: string;
  trigger: string;
  skill_id: string;
  skill_name: string;
  source: string;
  actor?: string;
  scan_status: "passed" | "flagged" | "unscanned";
  scan_summary?: string;
  scanner_unavailable?: boolean;
  duration_ms?: number;
}

export interface ScanTabProps {
  /** The skill being viewed. Must be a saved skill (the wizard step
   * is disabled for unsaved drafts upstream). */
  skillId: string;
  /** Display name for toasts and dialog copy. */
  skillName?: string;
  /** Called after a successful manual scan so the parent can refresh
   * the gallery / supervisor sync state. Optional. */
  onScanComplete?: () => void | Promise<void>;
}

/**
 * Hub-crawled rows arrive as `catalog-hub-<hubId>-<skillId>` and persist
 * in the `hub_skills` cache, so they need a dedicated scan endpoint.
 * Mirrors the same dispatch logic used by `SkillScanStatusIndicator` —
 * keep these two in sync.
 */
function resolveScanEndpoint(skillId: string): string {
  const hubMatch = skillId.match(/^catalog-hub-([^-]+)-(.+)$/);
  if (hubMatch) {
    const [, hubId, hubSkillId] = hubMatch;
    return `/api/skills/hub/${encodeURIComponent(hubId)}/${encodeURIComponent(hubSkillId)}/scan`;
  }
  return `/api/skills/configs/${encodeURIComponent(skillId)}/scan`;
}

export function ScanTab({
  skillId,
  skillName,
  onScanComplete,
}: ScanTabProps) {
  const { toast } = useToast();
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [scanning, setScanning] = useState(false);

  // ---- Load history -----------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/skills/scan-history?skill_id=${encodeURIComponent(skillId)}&page_size=100`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (cancelled) return;
        setEvents(j.data?.events || j.events || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "Failed to load history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, refreshTick]);

  // ---- Trigger scan ------------------------------------------------------
  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch(resolveScanEndpoint(skillId), {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data?.error === "string"
            ? data.error
            : data?.message || `Scan failed (${res.status})`;
        toast(msg, "error", 8000);
        return;
      }
      toast(
        skillName ? `Scan finished for "${skillName}"` : "Scan finished",
        "success",
      );
      // Refresh the audit trail so the new event shows up at the top.
      setRefreshTick((t) => t + 1);
      await onScanComplete?.();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Scan request failed",
        "error",
      );
    } finally {
      setScanning(false);
    }
  }, [skillId, skillName, onScanComplete, toast]);

  // ---- Derive view-model -----------------------------------------------
  const latest = events[0];
  const counts = events.reduce(
    (acc, ev) => {
      if (ev.scanner_unavailable) acc.unavailable += 1;
      else if (ev.scan_status === "passed") acc.passed += 1;
      else if (ev.scan_status === "flagged") acc.flagged += 1;
      else acc.unscanned += 1;
      return acc;
    },
    { passed: 0, flagged: 0, unscanned: 0, unavailable: 0 },
  );
  const hasNeverScanned = !loading && !error && events.length === 0;

  return (
    <div className="space-y-4" data-testid="skill-scan-tab">
      {/* ----------------------------------------------------------------
          (1) Primary action — Scan now
          The lead element is what the user came here to do. We keep
          copy short and explain what the scanner checks for so users
          aren't startled by a "Flagged" badge.
      ---------------------------------------------------------------- */}
      <div
        className="rounded-lg border border-border/60 bg-muted/20 p-4"
        data-testid="skill-scan-action"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 mt-0.5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold">Scan this skill</h2>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Runs the platform&apos;s skill-scanner over SKILL.md to look
              for prompt-injection patterns, secrets, and risky tool calls
              before agents execute it. Recommended after any edit that
              changes the instructions or adds new tools.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                onClick={runScan}
                disabled={scanning}
                size="sm"
                className="gap-1.5"
                data-testid="skill-scan-now"
              >
                {scanning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Scanning…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Scan now
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRefreshTick((t) => t + 1)}
                disabled={loading || scanning}
                className="gap-1.5"
                data-testid="skill-scan-refresh-history"
              >
                <RefreshCcw
                  className={cn(
                    "h-3.5 w-3.5",
                    loading && "animate-spin",
                  )}
                />
                Refresh history
              </Button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {/* ----------------------------------------------------------------
          (2) Latest scan banner — the answer to "did my last scan pass?"
          Hidden when there are no scans yet (the empty state below
          covers that case).
      ---------------------------------------------------------------- */}
      {latest && (
        <div
          className="rounded-md border border-border/60 bg-background p-3 space-y-2"
          data-testid="skill-scan-latest"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Latest scan
              </span>
              <StatusBadge
                status={latest.scan_status}
                unavailable={latest.scanner_unavailable}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">
              {new Date(latest.ts).toLocaleString()}
            </span>
          </div>
          {latest.scan_summary && (
            <p className="text-xs text-foreground/80 leading-relaxed">
              {latest.scan_summary}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span>
              Trigger:{" "}
              <span className="text-foreground/80">
                {latest.trigger.replace(/_/g, " ")}
              </span>
            </span>
            {latest.actor && (
              <>
                <span>•</span>
                <span>
                  Actor:{" "}
                  <span className="text-foreground/80">{latest.actor}</span>
                </span>
              </>
            )}
            <span>•</span>
            <span>
              Totals: {counts.passed} passed · {counts.flagged} flagged
              {counts.unavailable > 0
                ? ` · ${counts.unavailable} unavailable`
                : ""}
            </span>
          </div>
        </div>
      )}

      {hasNeverScanned && (
        <div
          className="rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground"
          data-testid="skill-scan-never"
        >
          This skill has never been scanned. Click{" "}
          <span className="font-medium text-foreground">Scan now</span>{" "}
          above to check it for prompt-injection patterns, secrets, and
          risky tool usage.
        </div>
      )}

      {/* ----------------------------------------------------------------
          (3) Audit trail — collapsed visually under the action above
          since most users only need the latest result. Header still
          uses the History icon so power users recognise the section.
      ---------------------------------------------------------------- */}
      {events.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <HistoryIcon className="h-3.5 w-3.5" />
            Scan history
            <span className="text-[10px] text-muted-foreground/70">
              ({events.length} {events.length === 1 ? "scan" : "scans"})
            </span>
          </div>
          <ScrollArea className="max-h-[420px] rounded-md border border-border/60">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Trigger</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr
                    key={ev.id}
                    className="border-t border-border/40 hover:bg-muted/30"
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {new Date(ev.ts).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        status={ev.scan_status}
                        unavailable={ev.scanner_unavailable}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-[10px]">
                        {ev.trigger.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {ev.actor || "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {ev.scan_summary || (
                        <span className="italic">No summary</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </section>
      )}
    </div>
  );
}

// Backwards-compat alias — older imports referenced `HistoryTab`. Keep
// the name resolvable so external callers (and stale tests) don't
// suddenly fail to compile if we missed a rename.
export { ScanTab as HistoryTab };

function StatusBadge({
  status,
  unavailable,
}: {
  status: "passed" | "flagged" | "unscanned";
  unavailable?: boolean;
}) {
  if (unavailable) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5",
          "bg-muted text-muted-foreground",
        )}
      >
        <ShieldQuestion className="h-3 w-3" />
        Unavailable
      </span>
    );
  }
  if (status === "passed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        Passed
      </span>
    );
  }
  if (status === "flagged") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5 bg-red-500/15 text-red-700 dark:text-red-400">
        <AlertTriangle className="h-3 w-3" />
        Flagged
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
      Not scanned
    </span>
  );
}
