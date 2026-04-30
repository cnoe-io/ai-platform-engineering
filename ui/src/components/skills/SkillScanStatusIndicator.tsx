"use client";

import React, { useState, useMemo } from "react";
import { ShieldCheck, ShieldAlert, Shield, Loader2, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { AgentSkill, ScanStatus } from "@/types/agent-skill";

const STATUS_COPY: Record<
  ScanStatus,
  { title: string; hint: string }
> = {
  passed: {
    title: "Security scan passed",
    hint: "No blocking findings for the last scan.",
  },
  flagged: {
    title: "Security scan flagged",
    hint: "Review the report below and fix issues if needed.",
  },
  unscanned: {
    title: "Not scanned",
    hint: "No scan yet, or the supervisor was unreachable when you saved.",
  },
};

function resolveStatus(config: Pick<AgentSkill, "scan_status">): ScanStatus {
  return config.scan_status ?? "unscanned";
}

function formatScanTime(value: Date | string | undefined): string | null {
  if (value == null) return null;
  try {
    const t = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(t.getTime())) return null;
    return t.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return null;
  }
}

export interface SkillScanStatusIndicatorProps {
  config: Pick<
    AgentSkill,
    "scan_status" | "scan_summary" | "name" | "id" | "scan_updated_at"
  >;
  /** Larger icon (e.g. builder header) */
  size?: "sm" | "md";
  className?: string;
  /** After a successful manual scan, refresh lists (e.g. loadSkills). */
  onScanComplete?: () => void | Promise<void>;
  /**
   * Manual scan applies to Mongo-backed skills and hub-crawled skills.
   * Default: hidden only for filesystem `catalog-default-*` chips, which have
   * no per-row scan state to persist.
   */
  allowManualScan?: boolean;
}

function defaultAllowManualScan(id: string): boolean {
  if (!id.startsWith("catalog-")) return true;
  if (id.startsWith("catalog-hub-")) return true;
  if (id.startsWith("catalog-agent_skills-")) return true;
  return false;
}

/**
 * Skill-scanner status: green (passed), red (flagged), orange (unscanned).
 * Hover: quick summary; click: full scan report + when scans run + Scan now.
 */
export function SkillScanStatusIndicator({
  config,
  size = "sm",
  className,
  onScanComplete,
  allowManualScan,
}: SkillScanStatusIndicatorProps) {
  // Defensive: callers (e.g. transient gallery rows mid-render, or "new"
  // skill workspace) can still pass `config={undefined}` despite the prop
  // type — short-circuit instead of crashing on `config.id`. Computing
  // `allowManualScan` from `config.id` in the parameter default itself
  // throws when `config` is undefined, which is what triggered the runtime
  // TypeError in production. Resolve it inside the body where we can guard.
  if (!config) return null;
  const effectiveAllowManualScan =
    allowManualScan ?? defaultAllowManualScan(config.id);
  const { toast } = useToast();
  const [reportOpen, setReportOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [localScan, setLocalScan] = useState<{
    scan_status?: ScanStatus;
    scan_summary?: string;
    scan_updated_at?: string;
  } | null>(null);

  const merged = useMemo(
    () => ({ ...config, ...localScan }),
    [config, localScan],
  );

  const status = resolveStatus(merged);
  const copy = STATUS_COPY[status];
  const summary = merged.scan_summary?.trim();
  const iconSize = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const lastScanLabel = formatScanTime(merged.scan_updated_at);

  const Icon =
    status === "passed"
      ? ShieldCheck
      : status === "flagged"
        ? ShieldAlert
        : Shield;

  /** Subtle tinted glyph; muted neutral for unscanned so it doesn't compete with badges. */
  const iconColorClass =
    status === "passed"
      ? "text-emerald-500 dark:text-emerald-400"
      : status === "flagged"
        ? "text-red-500 dark:text-red-400"
        : "text-muted-foreground/70";

  /** Soft tinted pill used inside the report dialog header (no shadow / ring). */
  const dialogPillClass =
    status === "passed"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : status === "flagged"
        ? "bg-red-500/15 text-red-600 dark:text-red-400"
        : "bg-muted text-muted-foreground";

  const preview =
    summary && summary.length > 220 ? `${summary.slice(0, 220)}…` : summary;

  // Scans run against the standalone cisco-ai-defense/skill-scanner
  // service (`SKILL_SCANNER_URL`), which is server-side only. We can't
  // probe its reachability from the browser, so we always allow the
  // user to click "Scan now" and surface any "scanner unavailable"
  // result via the returned `scan_status: "unscanned"` payload.
  const scannerConfigured = true;

  /**
   * Hub-crawled rows arrive as `catalog-hub-<hubId>-<skillId>` and live in the
   * `hub_skills` cache, not `agent_skills`. Route those to the dedicated
   * hub-scan endpoint so manual scans persist back to the hub cache doc.
   */
  const scanEndpoint = (() => {
    const hubMatch = config.id.match(/^catalog-hub-([^-]+)-(.+)$/);
    if (hubMatch) {
      const [, hubId, skillId] = hubMatch;
      return `/api/skills/hub/${encodeURIComponent(hubId)}/${encodeURIComponent(skillId)}/scan`;
    }
    return `/api/skills/configs/${encodeURIComponent(config.id)}/scan`;
  })();

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await fetch(scanEndpoint, {
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
      const payload = data?.data ?? data;
      setLocalScan({
        scan_status: payload.scan_status,
        scan_summary: payload.scan_summary,
        scan_updated_at: payload.scan_updated_at,
      });
      toast("Scan finished", "success");
      await onScanComplete?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Scan request failed", "error");
    } finally {
      setScanning(false);
    }
  };

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex items-center justify-center shrink-0 rounded-md",
                size === "md" ? "h-6 w-6" : "h-5 w-5",
                "text-muted-foreground hover:bg-muted/60 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                className,
              )}
              aria-label={`${copy.title}. Click for scan details and actions.`}
              onClick={(e) => {
                e.stopPropagation();
                setReportOpen(true);
              }}
            >
              {scanning ? (
                <Loader2 className={cn(iconSize, "animate-spin text-muted-foreground")} strokeWidth={2} />
              ) : (
                <Icon className={cn(iconSize, iconColorClass)} strokeWidth={2} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="max-w-[min(320px,calc(100vw-2rem))] whitespace-normal z-[10000] px-3 py-2"
          >
            <div className="space-y-1.5 text-left">
              <p className="font-semibold text-popover-foreground">{copy.title}</p>
              <p className="text-muted-foreground font-normal leading-snug">
                {preview || copy.hint}
              </p>
              {lastScanLabel && (
                <p className="text-[10px] text-muted-foreground/90">Last scan: {lastScanLabel}</p>
              )}
              <p className="text-[10px] text-muted-foreground/90 pt-0.5 border-t border-border/60">
                Open for full report and Scan now.
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent
          className="max-w-lg max-h-[85vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-8">
              <span className={cn("inline-flex items-center justify-center rounded-md p-1.5 shrink-0", dialogPillClass)}>
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
              Scan report — {merged.name || merged.id}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div
              className="flex gap-2 rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground leading-relaxed"
              role="note"
            >
              <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <div className="space-y-2">
                <p>
                  Status updates when you <strong className="text-foreground">save</strong> in Skills Builder or use{" "}
                  <strong className="text-foreground">Scan now</strong> below. Scans run against the
                  {" "}
                  <a
                    href="https://github.com/cisco-ai-defense/skill-scanner"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary font-medium hover:underline"
                  >
                    Skill Scanner
                  </a>
                  {" "}service, which must be reachable from the UI.
                </p>
              </div>
            </div>

            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Status:</span> {copy.title}
            </p>
            {lastScanLabel && (
              <p className="text-muted-foreground text-xs">
                <span className="font-medium text-foreground">Last scan saved:</span> {lastScanLabel}
              </p>
            )}

            <div className="rounded-md border bg-muted/40 p-3">
              <pre className="text-xs whitespace-pre-wrap break-words font-mono leading-relaxed">
                {summary ||
                  "No scan output yet. Save the skill or run Scan now."}
              </pre>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              {effectiveAllowManualScan && (
                <Button
                  type="button"
                  size="sm"
                  className="gap-2"
                  disabled={scanning || !scannerConfigured}
                  onClick={() => void runScan()}
                  title="Run Skill Scanner on this skill"
                >
                  {scanning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Scanning…
                    </>
                  ) : (
                    "Scan now"
                  )}
                </Button>
              )}
              <Button type="button" variant="secondary" size="sm" onClick={() => setReportOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
