"use client";

/**
 * VersionsTab — per-skill content version history.
 *
 * Companion to the Scan tab. Where Scan tracks "did the security
 * scanner like this version?", this tab tracks "what did the content
 * itself look like at each save / clone / file edit?". Backed by the
 * `skill_revisions` Mongo collection and the
 * /api/skills/configs/[id]/revisions endpoints.
 *
 * Surfaces:
 *   * Timeline list (newest first) with trigger badge, actor, time
 *   * "View" → full SKILL.md preview in a side dialog
 *   * "Restore" → confirm → POST .../revisions/[revisionId]/restore
 *
 * Retention is 10 by default (tunable via SKILL_REVISIONS_RETENTION).
 * The list is intentionally compact — older history is pruned on
 * write so we never need to paginate.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Eye,
  FileCode,
  History as HistoryIcon,
  Loader2,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  ShieldQuestion,
  ShieldAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface RevisionSummary {
  id: string;
  skill_id: string;
  created_at: string;
  actor?: string;
  trigger:
    | "create"
    | "update"
    | "file_edit"
    | "file_delete"
    | "clone"
    | "import"
    | "restore";
  revision_number: number;
  restored_from?: string;
  note?: string;
  name: string;
  category: string;
  scan_status?: "passed" | "flagged" | "unscanned";
  skill_content_size: number;
  ancillary_file_count: number;
  ancillary_total_size: number;
}

interface FullRevision extends RevisionSummary {
  description?: string;
  skill_content?: string;
  ancillary_files?: Record<string, string>;
}

export interface VersionsTabProps {
  /** Saved skill id. The wizard step is disabled for unsaved drafts. */
  skillId: string;
  /** Display name for toasts and dialog copy. */
  skillName?: string;
  /** Whether the user is allowed to restore (gated upstream by readOnly). */
  canRestore?: boolean;
  /** Called after a successful restore so the parent can re-fetch the skill. */
  onRestored?: () => void | Promise<void>;
}

const TRIGGER_LABELS: Record<RevisionSummary["trigger"], string> = {
  create: "Created",
  update: "Saved",
  file_edit: "File edit",
  file_delete: "File deleted",
  clone: "Cloned",
  import: "Imported",
  restore: "Restored",
};

const TRIGGER_VARIANTS: Record<
  RevisionSummary["trigger"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  create: "default",
  update: "secondary",
  file_edit: "outline",
  file_delete: "destructive",
  clone: "default",
  import: "default",
  restore: "secondary",
};

export function VersionsTab({
  skillId,
  skillName,
  canRestore = true,
  onRestored,
}: VersionsTabProps) {
  const { toast } = useToast();
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Selected revision for preview/diff. We always fetch the FULL doc
  // when opening the preview because the list view strips heavy
  // fields (skill_content + ancillary contents) for performance.
  const [previewing, setPreviewing] = useState<FullRevision | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Restore confirmation flow.
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoringInFlight, setRestoringInFlight] = useState(false);

  // ---- Load list --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/skills/configs/${encodeURIComponent(skillId)}/revisions`,
      { credentials: "include" },
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (cancelled) return;
        const list: RevisionSummary[] = j.data?.revisions || j.revisions || [];
        setRevisions(list);
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

  // ---- Open preview -----------------------------------------------------
  const openPreview = useCallback(
    async (rev: RevisionSummary) => {
      setPreviewLoading(true);
      try {
        const res = await fetch(
          `/api/skills/configs/${encodeURIComponent(skillId)}/revisions/${encodeURIComponent(rev.id)}`,
          { credentials: "include" },
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const j = await res.json();
        const full: FullRevision = j.data?.revision || j.revision;
        setPreviewing(full);
      } catch (e) {
        toast(
          e instanceof Error ? e.message : "Failed to load revision",
          "error",
        );
      } finally {
        setPreviewLoading(false);
      }
    },
    [skillId, toast],
  );

  // ---- Restore ----------------------------------------------------------
  const performRestore = useCallback(async () => {
    if (!restoringId) return;
    setRestoringInFlight(true);
    try {
      const res = await fetch(
        `/api/skills/configs/${encodeURIComponent(skillId)}/revisions/${encodeURIComponent(restoringId)}/restore`,
        { method: "POST", credentials: "include" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data?.error === "string"
            ? data.error
            : data?.message || `Restore failed (${res.status})`;
        toast(msg, "error", 8000);
        return;
      }
      toast(
        skillName
          ? `Restored "${skillName}" to revision #${data.data?.restored_revision_number ?? data.restored_revision_number ?? ""}`
          : "Revision restored",
        "success",
      );
      setRestoringId(null);
      setRefreshTick((t) => t + 1);
      await onRestored?.();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Restore request failed",
        "error",
      );
    } finally {
      setRestoringInFlight(false);
    }
  }, [restoringId, skillId, skillName, onRestored, toast]);

  // ---- Derive view-model ------------------------------------------------
  // Top-of-list is the most recent (current) state. We render a small
  // "current" pill on row 0 so the user knows clicking Restore on row
  // 1+ is what reverts the skill — restoring row 0 would be a no-op.
  const isCurrent = useCallback(
    (rev: RevisionSummary) =>
      revisions.length > 0 && rev.id === revisions[0].id,
    [revisions],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border/40 pb-3">
        <HistoryIcon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Version history</h2>
        <Badge variant="outline" className="text-[10px]">
          last 10
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5"
          onClick={() => setRefreshTick((t) => t + 1)}
          disabled={loading}
          title="Reload history"
        >
          <RefreshCcw
            className={cn("h-3 w-3", loading && "animate-spin")}
          />
          Refresh
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        A snapshot is recorded every time a content field changes
        (create, save, file edit, clone, import). Older revisions are
        pruned automatically so this list never grows past 10. Use
        Restore to roll the live skill back to an earlier snapshot —
        the restore itself is captured as a new revision so you can
        always undo the undo.
      </p>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">Could not load history</div>
            <div className="mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {loading && revisions.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading revisions…
        </div>
      )}

      {!loading && !error && revisions.length === 0 && (
        <div className="rounded-md border border-dashed border-border/60 p-8 text-center text-xs text-muted-foreground">
          No revisions recorded yet. Save the skill once to capture
          its first snapshot.
        </div>
      )}

      {revisions.length > 0 && (
        <div className="rounded-md border border-border/60 divide-y divide-border/40">
          {revisions.map((rev) => {
            const current = isCurrent(rev);
            return (
              <RevisionRow
                key={rev.id}
                rev={rev}
                isCurrent={current}
                canRestore={canRestore && !current}
                onView={() => void openPreview(rev)}
                onRestore={() => setRestoringId(rev.id)}
              />
            );
          })}
        </div>
      )}

      {/* Preview dialog — read-only side panel of the chosen revision. */}
      <Dialog
        open={!!previewing}
        onOpenChange={(open) => {
          if (!open) setPreviewing(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="h-4 w-4" />
              Revision #{previewing?.revision_number}
            </DialogTitle>
            <DialogDescription>
              {previewing &&
                `Captured ${formatTime(previewing.created_at)}${previewing.actor ? ` by ${previewing.actor}` : ""}. Trigger: ${TRIGGER_LABELS[previewing.trigger]}.`}
            </DialogDescription>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin mr-2" />
              Loading…
            </div>
          ) : previewing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Detail label="Name" value={previewing.name} />
                <Detail label="Category" value={previewing.category} />
                <Detail
                  label="Description"
                  value={previewing.description || "—"}
                />
                <Detail
                  label="Scan status"
                  value={previewing.scan_status || "unscanned"}
                />
                <Detail
                  label="SKILL.md size"
                  value={formatBytes(previewing.skill_content_size)}
                />
                <Detail
                  label="Ancillary files"
                  value={`${previewing.ancillary_file_count} (${formatBytes(previewing.ancillary_total_size)})`}
                />
              </div>
              <div className="rounded-md border border-border/60">
                <div className="border-b border-border/40 bg-muted/30 px-3 py-1.5 text-[11px] font-medium">
                  SKILL.md
                </div>
                <ScrollArea className="h-72">
                  <pre className="whitespace-pre-wrap break-words p-3 text-[11px] font-mono">
                    {previewing.skill_content || "(empty)"}
                  </pre>
                </ScrollArea>
              </div>
              {previewing.ancillary_files &&
                Object.keys(previewing.ancillary_files).length > 0 && (
                  <div className="rounded-md border border-border/60">
                    <div className="border-b border-border/40 bg-muted/30 px-3 py-1.5 text-[11px] font-medium">
                      Ancillary files
                    </div>
                    <ul className="divide-y divide-border/40 text-xs">
                      {Object.entries(previewing.ancillary_files).map(
                        ([path, content]) => (
                          <li
                            key={path}
                            className="flex items-center justify-between gap-2 px-3 py-1.5"
                          >
                            <code className="font-mono text-[11px] truncate">
                              {path}
                            </code>
                            <span className="text-[11px] text-muted-foreground">
                              {formatBytes(
                                Buffer.byteLength(content, "utf-8"),
                              )}
                            </span>
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreviewing(null)}>
              Close
            </Button>
            {previewing && canRestore && !isCurrent(previewing) && (
              <Button
                variant="default"
                onClick={() => {
                  const id = previewing.id;
                  setPreviewing(null);
                  setRestoringId(id);
                }}
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore this revision
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore confirmation dialog. We deliberately make this a
          two-step flow because Restore is destructive (overwrites
          live SKILL.md and ancillary files) — a single misclick
          shouldn't be able to swap content. */}
      <Dialog
        open={!!restoringId}
        onOpenChange={(open) => {
          if (!open && !restoringInFlight) setRestoringId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4" />
              Restore this revision?
            </DialogTitle>
            <DialogDescription>
              This will overwrite the current SKILL.md, ancillary
              files, and form fields with the snapshot from this
              revision. The current state is captured as a new
              revision first, so you can roll back the restore if
              needed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRestoringId(null)}
              disabled={restoringInFlight}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={() => void performRestore()}
              disabled={restoringInFlight}
              className="gap-1.5"
            >
              {restoringInFlight ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              {restoringInFlight ? "Restoring…" : "Restore"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface RevisionRowProps {
  rev: RevisionSummary;
  isCurrent: boolean;
  canRestore: boolean;
  onView: () => void;
  onRestore: () => void;
}

function RevisionRow({
  rev,
  isCurrent,
  canRestore,
  onView,
  onRestore,
}: RevisionRowProps) {
  const ScanIcon = scanIconFor(rev.scan_status);
  return (
    <div className="flex items-start gap-3 px-3 py-2 hover:bg-muted/30">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold">
        {rev.revision_number}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={TRIGGER_VARIANTS[rev.trigger]}
            className="text-[10px]"
          >
            {TRIGGER_LABELS[rev.trigger]}
          </Badge>
          {isCurrent && (
            <Badge variant="outline" className="text-[10px]">
              current
            </Badge>
          )}
          <span className="text-[11px] text-muted-foreground">
            {formatTime(rev.created_at)}
            {rev.actor ? ` · ${rev.actor}` : ""}
          </span>
          {rev.scan_status && (
            <span
              className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground"
              title={`Scan status at this revision: ${rev.scan_status}`}
            >
              <ScanIcon className="h-3 w-3" />
              {rev.scan_status}
            </span>
          )}
        </div>
        {rev.note && (
          <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
            {rev.note}
          </div>
        )}
        <div className="mt-1 text-[10px] text-muted-foreground">
          SKILL.md {formatBytes(rev.skill_content_size)} ·{" "}
          {rev.ancillary_file_count} ancillary file
          {rev.ancillary_file_count === 1 ? "" : "s"} (
          {formatBytes(rev.ancillary_total_size)})
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1"
          onClick={onView}
          title="View this revision"
        >
          <Eye className="h-3 w-3" />
          View
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1"
          onClick={onRestore}
          disabled={!canRestore}
          title={
            canRestore
              ? "Roll the skill back to this snapshot"
              : isCurrent
                ? "This is the current state"
                : "You don't have permission to restore"
          }
        >
          <RotateCcw className="h-3 w-3" />
          Restore
        </Button>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-[11px] font-medium break-words">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scanIconFor(status: RevisionSummary["scan_status"]) {
  switch (status) {
    case "passed":
      return ShieldCheck;
    case "flagged":
      return ShieldAlert;
    default:
      return ShieldQuestion;
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
