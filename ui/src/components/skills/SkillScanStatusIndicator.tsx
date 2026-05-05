"use client";

import React, { useState, useMemo } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Shield,
  Loader2,
  Info,
  ShieldOff,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useAdminRole } from "@/hooks/use-admin-role";
import { cn } from "@/lib/utils";
import type {
  AgentSkill,
  PersistedScanStatus,
  ScanOverride,
} from "@/types/agent-skill";

/**
 * Status copy + tooltip hint per persisted status.
 *
 * ``admin_overridden`` is the only status that the scanner does NOT
 * produce on its own — it's set by the per-skill override route when
 * an admin explicitly green-lights a previously-flagged skill. The
 * copy is intentionally distinct ("scanner had flagged…") so it's
 * obvious that a human action is in play, not a clean scanner verdict.
 */
const STATUS_COPY: Record<
  PersistedScanStatus,
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
  admin_overridden: {
    title: "Admin override active",
    hint:
      "Scanner had flagged this skill; an admin has explicitly green-lit it. " +
      "Open for the override reason and rescan options.",
  },
};

function resolveStatus(
  config: Pick<AgentSkill, "scan_status">,
): PersistedScanStatus {
  return (config.scan_status as PersistedScanStatus | undefined) ?? "unscanned";
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
    | "scan_status"
    | "scan_summary"
    | "name"
    | "id"
    | "scan_updated_at"
    | "metadata"
    // Optional override audit metadata. Surfaced inside the dialog
    // when ``scan_status === "admin_overridden"`` so reviewers see
    // who set it / when / why without leaving the gallery.
    | "scan_override"
  >;
  /** Larger icon (e.g. builder header) */
  size?: "sm" | "md";
  className?: string;
  /** After a successful manual scan, refresh lists (e.g. loadSkills). */
  onScanComplete?: () => void | Promise<void>;
  /**
   * Manual scan applies to Mongo-backed skills, hub-crawled skills, and
   * (since the `builtin_skill_scans` collection landed) packaged
   * filesystem templates. Default: allowed for every recognized catalog
   * source. Pass `false` to lock the dialog into read-only mode.
   */
  allowManualScan?: boolean;
}

function defaultAllowManualScan(): boolean {
  // Every catalog source now has a server-side scan endpoint:
  //   agent_skills   → POST /api/skills/configs/[id]/scan
  //   hub            → POST /api/skills/hub/[hubId]/[skillId]/scan
  //   default        → POST /api/skill-templates/[id]/scan
  // The dialog hides Scan now if the caller explicitly disables it.
  return true;
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
    allowManualScan ?? defaultAllowManualScan();
  const { toast } = useToast();
  const { isAdmin } = useAdminRole();
  const [reportOpen, setReportOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Override-form local state. Folded into a single object so the
  // form open/close + reason + busy state stay in sync; using three
  // separate hooks here invited a bug where Cancel left "submitting"
  // true.
  const [overrideForm, setOverrideForm] = useState<{
    open: boolean;
    reason: string;
    busy: boolean;
  }>({ open: false, reason: "", busy: false });
  const [localScan, setLocalScan] = useState<{
    scan_status?: PersistedScanStatus;
    scan_summary?: string;
    scan_updated_at?: string;
    scan_override?: ScanOverride | null;
  } | null>(null);

  const merged = useMemo(() => {
    // localScan can explicitly null-out scan_override (clear path);
    // we honour that by stripping the field rather than just merging.
    const base = { ...config, ...localScan };
    if (localScan?.scan_override === null) {
      delete (base as { scan_override?: unknown }).scan_override;
    }
    return base;
  }, [config, localScan]);

  const status = resolveStatus(merged);
  const copy = STATUS_COPY[status];
  const summary = merged.scan_summary?.trim();
  const iconSize = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const lastScanLabel = formatScanTime(merged.scan_updated_at);

  // Icon palette — admin_overridden uses a distinct glyph
  // (ShieldOff) and amber palette so a reviewer can tell at a
  // glance "this isn't scanner-clean, it's admin-bypass". Sharing
  // ShieldAlert + red with the flagged state would conflate the two.
  const Icon =
    status === "passed"
      ? ShieldCheck
      : status === "flagged"
        ? ShieldAlert
        : status === "admin_overridden"
          ? ShieldOff
          : Shield;

  /** Subtle tinted glyph; muted neutral for unscanned so it doesn't compete with badges. */
  const iconColorClass =
    status === "passed"
      ? "text-emerald-500 dark:text-emerald-400"
      : status === "flagged"
        ? "text-red-500 dark:text-red-400"
        : status === "admin_overridden"
          ? "text-amber-500 dark:text-amber-400"
          : "text-muted-foreground/70";

  /** Soft tinted pill used inside the report dialog header (no shadow / ring). */
  const dialogPillClass =
    status === "passed"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : status === "flagged"
        ? "bg-red-500/15 text-red-600 dark:text-red-400"
        : status === "admin_overridden"
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
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
   * Catalog rows are prefixed with `catalog-` and need to be split by source
   * because each source has its own persistence model:
   *
   *   catalog-hub-<hubId>-<skillId>  → POST /api/skills/hub/.../scan
   *                                    (persists into `hub_skills` cache)
   *   catalog-default-* (source==="default") → POST /api/skill-templates/<id>/scan
   *                                    (persists into `builtin_skill_scans`)
   *   anything else                  → POST /api/skills/configs/<id>/scan
   *                                    (persists onto the agent_skills doc)
   *
   * `metadata.catalog_source` is the source of truth (set by the
   * gallery's `/api/skills` mapping); the id-prefix fallback handles
   * legacy callers that don't pass metadata.
   */
  const scanEndpoint = (() => {
    const hubMatch = config.id.match(/^catalog-hub-([^-]+)-(.+)$/);
    if (hubMatch) {
      const [, hubId, skillId] = hubMatch;
      return `/api/skills/hub/${encodeURIComponent(hubId)}/${encodeURIComponent(skillId)}/scan`;
    }
    const catalogSource = (
      config.metadata as { catalog_source?: string } | undefined
    )?.catalog_source;
    if (catalogSource === "default" && config.id.startsWith("catalog-")) {
      // Strip the `catalog-` prefix to recover the loader's template id.
      const templateId = config.id.slice("catalog-".length);
      return `/api/skill-templates/${encodeURIComponent(templateId)}/scan`;
    }
    return `/api/skills/configs/${encodeURIComponent(config.id)}/scan`;
  })();

  /**
   * Override endpoint resolver.
   *
   * v1 scope: only ``agent_skills`` skills can be overridden — built-
   * in templates live on disk (no per-skill admin UI yet) and hub
   * skills are crawled (no doc to write override metadata onto).
   * Returns ``null`` for unsupported sources so the dialog can hide
   * the buttons cleanly without a runtime branch in the JSX.
   *
   * The route the URL points at validates the source again on the
   * server (``assertSupportedSource``) so a stale UI can't open a
   * 500-style hole.
   */
  const overrideEndpoint = (() => {
    const hubMatch = config.id.match(/^catalog-hub-([^-]+)-(.+)$/);
    if (hubMatch) return null;
    const catalogSource = (
      config.metadata as { catalog_source?: string } | undefined
    )?.catalog_source;
    if (catalogSource === "default") return null;
    // catalog-* prefix on agent_skills rows is harmless — the override
    // route uses ``id`` as written in the doc, so we pass through the
    // same id we'd use for scan.
    const skillId = config.id.startsWith("catalog-")
      ? config.id.slice("catalog-".length)
      : config.id;
    return `/api/admin/skills/agent_skills/${encodeURIComponent(skillId)}/scan-override`;
  })();
  // Admin gate on the buttons: must be admin role AND the source has
  // to support overrides AND we have a flagged-or-overridden status.
  // Other UI paths (e.g. SSO not configured / dev admin) flow through
  // useAdminRole; we don't re-check here.
  const adminCanOverride = isAdmin && overrideEndpoint !== null;
  const showOverrideButton = adminCanOverride && status === "flagged";
  const showClearOverrideButton =
    adminCanOverride && status === "admin_overridden";

  const overrideMeta = merged.scan_override;
  const overrideSetAtLabel = overrideMeta
    ? formatScanTime(overrideMeta.set_at)
    : null;

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
        // The rescan route auto-clears overrides on a clean verdict
        // (see route.override-revert tests). Mirror that here so the
        // dialog re-renders with the override gone immediately,
        // without waiting for the parent's onScanComplete refresh.
        scan_override: payload.override_auto_cleared ? null : undefined,
      });
      toast("Scan finished", "success");
      await onScanComplete?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Scan request failed", "error");
    } finally {
      setScanning(false);
    }
  };

  const submitOverride = async () => {
    if (!overrideEndpoint) return; // Defensive — button hidden anyway.
    const reason = overrideForm.reason.trim();
    if (reason.length === 0) {
      toast(
        "Please enter a reason — overrides are audit-logged and " +
          "require justification.",
        "error",
      );
      return;
    }
    setOverrideForm((s) => ({ ...s, busy: true }));
    try {
      const res = await fetch(overrideEndpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data?.error === "string"
            ? data.error
            : data?.message || `Override failed (${res.status})`;
        toast(msg, "error", 8000);
        return;
      }
      const payload = data?.data ?? data;
      setLocalScan({
        scan_status: payload.scan_status,
        // Server may not echo summary on override; keep the existing
        // value visible so the report shows what was overridden.
        scan_summary: merged.scan_summary,
        scan_updated_at: payload.scan_updated_at,
        scan_override: payload.scan_override ?? undefined,
      });
      setOverrideForm({ open: false, reason: "", busy: false });
      toast("Override applied", "success");
      await onScanComplete?.();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Override request failed",
        "error",
      );
    } finally {
      setOverrideForm((s) => ({ ...s, busy: false }));
    }
  };

  const clearOverride = async () => {
    if (!overrideEndpoint) return;
    setOverrideForm((s) => ({ ...s, busy: true }));
    try {
      const res = await fetch(overrideEndpoint, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data?.error === "string"
            ? data.error
            : data?.message || `Clear failed (${res.status})`;
        toast(msg, "error", 8000);
        return;
      }
      const payload = data?.data ?? data;
      setLocalScan({
        // After clear the route flips status back to flagged. Echo
        // that so the indicator immediately shows the red shield
        // again (and the gallery row, when its parent refreshes).
        scan_status: payload.scan_status,
        scan_summary: merged.scan_summary,
        scan_updated_at: payload.scan_updated_at,
        // Explicit null sentinel — see merged useMemo: null tells
        // the merge to delete the field, not to spread an undefined.
        scan_override: null,
      });
      toast("Override removed", "success");
      await onScanComplete?.();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Clear request failed",
        "error",
      );
    } finally {
      setOverrideForm((s) => ({ ...s, busy: false }));
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

            {/*
             * Admin override audit panel. Shown whenever the persisted
             * status is admin_overridden, regardless of viewer role —
             * non-admins still get to see "this skill is admin-bypass"
             * with the reason, just without the buttons. Source of
             * truth for the audit trail; the dialog action buttons
             * only mutate; this panel is read-only.
             */}
            {status === "admin_overridden" && overrideMeta && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1.5">
                <p className="font-semibold text-amber-700 dark:text-amber-400">
                  Admin override active
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Scanner had returned{" "}
                  <span className="font-mono text-foreground">
                    {overrideMeta.prior_scan_status}
                  </span>
                  . An admin has explicitly green-lit this skill for
                  runtime use; the override can be removed from this
                  dialog (admin only).
                </p>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-2 gap-y-1 text-muted-foreground">
                  <dt className="font-medium text-foreground">Set by</dt>
                  <dd className="font-mono break-all">{overrideMeta.set_by}</dd>
                  {overrideSetAtLabel && (
                    <>
                      <dt className="font-medium text-foreground">Set at</dt>
                      <dd>{overrideSetAtLabel}</dd>
                    </>
                  )}
                  <dt className="font-medium text-foreground">Reason</dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {overrideMeta.reason}
                  </dd>
                </dl>
              </div>
            )}

            {/*
             * Override-form inline panel. Visible only when the user
             * is admin AND the skill is currently flagged AND the
             * form has been opened via the "Override flag" button
             * below. Lives inside the dialog (not a nested dialog)
             * to avoid a double-modal that complicates focus
             * management.
             */}
            {showOverrideButton && overrideForm.open && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-2">
                <p className="font-semibold text-amber-700 dark:text-amber-400">
                  Override scanner verdict
                </p>
                <p className="text-muted-foreground leading-snug">
                  This will mark the skill as admin-overridden and
                  allow the runtime to serve it despite the flagged
                  scan. Your reason is persisted on the skill and
                  written to the override audit log.
                </p>
                <Textarea
                  value={overrideForm.reason}
                  onChange={(e) =>
                    setOverrideForm((s) => ({
                      ...s,
                      reason: e.target.value,
                    }))
                  }
                  placeholder="e.g. Reviewed the shell-out finding; all paths use a strict allow-list."
                  rows={3}
                  maxLength={4096}
                  disabled={overrideForm.busy}
                  aria-label="Override reason"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setOverrideForm({
                        open: false,
                        reason: "",
                        busy: false,
                      })
                    }
                    disabled={overrideForm.busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-2"
                    onClick={() => void submitOverride()}
                    disabled={
                      overrideForm.busy ||
                      overrideForm.reason.trim().length === 0
                    }
                  >
                    {overrideForm.busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Submitting…
                      </>
                    ) : (
                      "Confirm override"
                    )}
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-md border bg-muted/40 p-3">
              <pre className="text-xs whitespace-pre-wrap break-words font-mono leading-relaxed">
                {summary ||
                  "No scan output yet. Save the skill or run Scan now."}
              </pre>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              {showOverrideButton && !overrideForm.open && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-2 border-amber-500/60 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                  onClick={() =>
                    setOverrideForm({ open: true, reason: "", busy: false })
                  }
                  title="Admin: explicitly green-light this flagged skill (audit-logged)"
                >
                  Override flag…
                </Button>
              )}
              {showClearOverrideButton && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  disabled={overrideForm.busy}
                  onClick={() => void clearOverride()}
                  title="Admin: remove the override and let the scanner verdict take effect again"
                >
                  {overrideForm.busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Removing…
                    </>
                  ) : (
                    "Remove override"
                  )}
                </Button>
              )}
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
