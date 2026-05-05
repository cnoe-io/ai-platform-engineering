"use client";

/**
 * ImportSkillZipDialog — UI driver for POST /api/skills/configs/import-zip.
 *
 * Two-phase flow with optional single-skill shortcut:
 *
 *   1. The user picks a `.zip` file. We send it to the route with no
 *      `resolutions` field; the server replies with a candidate list
 *      and any duplicate-name conflicts against the user's catalog.
 *   2. If the zip has exactly one candidate AND the parent provided
 *      an `onSingleSkillApplied` callback, we close immediately and
 *      let the parent inline the SKILL.md + ancillary files into the
 *      currently-open Skill Workspace draft. This is the "single-
 *      skill review" path — the user edits before committing.
 *   3. Otherwise we render a checklist of candidates (so the user
 *      can de-select skills they don't want) and, when conflicts
 *      exist, hand control to <ImportConflictDialog> for skip /
 *      overwrite / rename decisions.
 *   4. The user clicks "Import N skills"; we re-upload the same zip
 *      with the resolutions JSON. The server returns a per-row
 *      summary which we surface inline before closing.
 *
 * The component is self-contained: it owns its phase state machine,
 * never reaches into the parent's catalog, and always returns to a
 * clean idle state on cancel/success so it can be reused by both
 * the Skills Gallery toolbar (bulk) and the Skill Workspace (single
 * skill).
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Archive,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ImportConflictDialog } from "@/components/skills/ImportConflictDialog";
import type { ImportConflictDecision } from "@/lib/skill-import-helpers";

// ---------------------------------------------------------------------------
// Wire types — must match the route's response shape
// ---------------------------------------------------------------------------

interface CandidateSummary {
  candidateId: string;
  directory: string;
  proposedName: string;
  description: string;
  bytes: number;
  ancillaryCount: number;
  skippedFiles: string[];
}

interface AnalyzeResponse {
  phase: "analyze";
  candidates: CandidateSummary[];
  conflicts: ImportConflictDecision[];
  totalBytes: number;
  totalEntries: number;
}

interface ImportedRow {
  candidateId: string;
  skillId: string;
  name: string;
  scan_status: "passed" | "flagged" | "unscanned";
  scan_summary?: string;
  outcome: "created" | "overwritten" | "skipped" | "failed";
  error?: string;
}

interface ImportResponse {
  phase: "import";
  imported: ImportedRow[];
}

// ---------------------------------------------------------------------------
// Shape passed to the workspace's single-skill consumer
// ---------------------------------------------------------------------------

export interface ZipSingleSkillPayload {
  /** Display name pulled from the zip's SKILL.md frontmatter / H1. */
  proposedName: string;
  /** Description from the zip's frontmatter (may be empty). */
  description: string;
  /** Raw SKILL.md body. */
  skillContent: string;
  /** Ancillary files keyed by relative path. */
  ancillaryFiles: Record<string, string>;
}

export interface ImportSkillZipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional. When provided AND the uploaded zip contains exactly one
   * SKILL.md, the dialog skips the bulk-import API entirely and hands
   * the parsed payload to the parent so it can populate the editor.
   * Used by the Skill Workspace for the "Import .zip" button.
   *
   * If omitted, every zip — including single-skill ones — goes
   * through the import API.
   */
  onSingleSkillApplied?: (payload: ZipSingleSkillPayload) => void;
  /**
   * Optional. Called after a successful bulk import so the parent
   * can refresh its catalog (Skills Gallery passes its `reloadAll`
   * here).
   */
  onBulkImported?: () => void;
}

const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const ACCEPT_TYPES = ".zip,application/zip,application/x-zip-compressed";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; label: string }
  | {
      kind: "analyzed";
      analysis: AnalyzeResponse;
      file: File;
      selectedIds: Set<string>;
      conflictResolutions: ImportConflictDecision[] | null;
      showConflictDialog: boolean;
    }
  | { kind: "imported"; imported: ImportedRow[] };

export function ImportSkillZipDialog({
  open,
  onOpenChange,
  onSingleSkillApplied,
  onBulkImported,
}: ImportSkillZipDialogProps) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // We re-fetch the SKILL.md content for the single-skill shortcut
  // by reading the file via the browser's zip parser. Loading jszip
  // dynamically here mirrors the server-side strategy and keeps the
  // shared bundle small.
  const inlineSingleSkill = useCallback(
    async (file: File): Promise<ZipSingleSkillPayload | null> => {
      const { default: JSZip } = await import("jszip");
      const buffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      // Find the single SKILL.md the server already validated. We
      // re-parse instead of trusting client state because the file
      // is the source of truth and the user may have edited the
      // archive after the analyze response landed (rare but cheap
      // to defend against).
      let skillMdEntry: { path: string; content: string } | null = null;
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        if (/(?:^|\/)SKILL\.md$/i.test(path)) {
          if (skillMdEntry) {
            // More than one — fall back to bulk path.
            return null;
          }
          skillMdEntry = { path, content: await entry.async("text") };
        }
      }
      if (!skillMdEntry) return null;
      const skillDir = skillMdEntry.path.replace(/(?:^|\/)SKILL\.md$/i, "");
      const prefix = skillDir ? `${skillDir}/` : "";
      const ancillaryFiles: Record<string, string> = {};
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        if (path === skillMdEntry.path) continue;
        if (prefix && !path.startsWith(prefix)) continue;
        if (!prefix && path.includes("/")) continue;
        const rel = prefix ? path.slice(prefix.length) : path;
        ancillaryFiles[rel] = await entry.async("text");
      }

      // Pull display name + description out of the SKILL.md so the
      // workspace can pre-fill the form. We import the parser
      // lazily — this dialog isn't on every page.
      const { parseSkillMd } = await import("@/lib/skill-md-parser");
      const parsed = parseSkillMd(skillMdEntry.content);
      const proposedName =
        parsed.title || parsed.name || skillDir.split("/").pop() || "Imported skill";
      return {
        proposedName,
        description: parsed.description,
        skillContent: skillMdEntry.content,
        ancillaryFiles,
      };
    },
    [],
  );

  const reset = useCallback(() => {
    setPhase({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_ZIP_BYTES) {
        toast(
          `Zip is ${(file.size / 1024 / 1024).toFixed(1)} MB; max is 50 MB.`,
          "error",
        );
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      // Single-skill shortcut: if the parent wants to receive a
      // single-skill payload, try the in-browser parse first.
      // Falls back to the bulk API on any failure (multi-skill,
      // garbage zip, etc.) — the API gives much richer error
      // surfaces.
      if (onSingleSkillApplied) {
        try {
          const payload = await inlineSingleSkill(file);
          if (payload) {
            onSingleSkillApplied(payload);
            toast(`Imported "${payload.proposedName}" into the editor`, "success");
            reset();
            onOpenChange(false);
            return;
          }
          // null === multi-skill zip; fall through to bulk path so
          // the user picks which skill to import.
        } catch (err) {
          // Re-throw to the bulk path — the API will return a
          // structured error if the zip really is broken.
          console.warn("[ImportZip] single-skill parse failed:", err);
        }
      }

      setPhase({ kind: "uploading", label: "Analysing zip…" });
      try {
        const form = new FormData();
        form.append("file", file);
        const resp = await fetch("/api/skills/configs/import-zip", {
          method: "POST",
          body: form,
          credentials: "include",
        });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || `HTTP ${resp.status}`);
        }
        const data = (await resp.json()) as
          | { data: AnalyzeResponse }
          | AnalyzeResponse;
        const analysis: AnalyzeResponse =
          "data" in data ? data.data : (data as AnalyzeResponse);
        if (analysis.candidates.length === 0) {
          throw new Error("No SKILL.md files found in the zip.");
        }
        setPhase({
          kind: "analyzed",
          analysis,
          file,
          selectedIds: new Set(analysis.candidates.map((c) => c.candidateId)),
          conflictResolutions: null,
          // Pop the conflict modal automatically when the zip ships
          // with at least one collision; otherwise user can hit
          // "Import" without an extra step.
          showConflictDialog: analysis.conflicts.length > 0,
        });
      } catch (err) {
        toast(
          `Import analysis failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
        reset();
      }
    },
    [onSingleSkillApplied, inlineSingleSkill, reset, toast, onOpenChange],
  );

  const handleConflictResolve = useCallback(
    (decisions: ImportConflictDecision[]) => {
      setPhase((prev) =>
        prev.kind === "analyzed"
          ? {
              ...prev,
              conflictResolutions: decisions,
              showConflictDialog: false,
            }
          : prev,
      );
    },
    [],
  );

  const handleConflictCancel = useCallback(() => {
    // Cancelling the conflict dialog returns the user to the
    // candidate-checklist view with no resolutions chosen yet —
    // they can re-open the dialog or cancel the whole import.
    setPhase((prev) =>
      prev.kind === "analyzed"
        ? { ...prev, showConflictDialog: false }
        : prev,
    );
  }, []);

  const handleImport = useCallback(async () => {
    if (phase.kind !== "analyzed") return;
    const { analysis, file, selectedIds, conflictResolutions } = phase;

    // Defence in depth: if conflicts exist and the user never
    // resolved them, we treat all conflicts as `skip`. The conflict
    // dialog already defaults to skip so this is a no-op when the
    // user took the default path; it only matters when the user
    // closed the conflict dialog without applying.
    const finalResolutions: ImportConflictDecision[] = analysis.conflicts.map(
      (c) => {
        const fromUser = conflictResolutions?.find(
          (r) => r.candidateId === c.candidateId,
        );
        return fromUser ?? { ...c, action: "skip" };
      },
    );

    // The server keys imports by candidate id — to honour the
    // checkbox de-selection we mark every NOT-selected candidate
    // as skip. Conflicts are always present in resolutions; we add
    // synthetic skip rows for the rest.
    const selectedSet = selectedIds;
    for (const cand of analysis.candidates) {
      if (selectedSet.has(cand.candidateId)) continue;
      // Already represented in finalResolutions? Force to skip.
      const existing = finalResolutions.find(
        (r) => r.candidateId === cand.candidateId,
      );
      if (existing) {
        existing.action = "skip";
      } else {
        finalResolutions.push({
          candidateId: cand.candidateId,
          candidateName: cand.proposedName,
          existingName: cand.proposedName,
          action: "skip",
        });
      }
    }

    setPhase({ kind: "uploading", label: "Importing skills…" });
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("resolutions", JSON.stringify(finalResolutions));
      const resp = await fetch("/api/skills/configs/import-zip", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as
        | { data: ImportResponse }
        | ImportResponse;
      const importResp: ImportResponse =
        "data" in data ? data.data : (data as ImportResponse);
      setPhase({ kind: "imported", imported: importResp.imported });
      onBulkImported?.();
    } catch (err) {
      toast(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
      // Drop back to the analyzed phase so the user can retry
      // without re-selecting their zip and resolutions.
      setPhase(phase);
    }
  }, [phase, onBulkImported, toast]);

  const handleClose = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [reset, onOpenChange]);

  // Only forward open changes when the user is in idle / imported;
  // mid-flow closes via the explicit Cancel button so accidental
  // backdrop clicks don't lose work.
  const allowExternalClose = phase.kind === "idle" || phase.kind === "imported";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && !allowExternalClose) return;
          if (!o) reset();
          onOpenChange(o);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-4 w-4" />
              Import skills from .zip
            </DialogTitle>
            <DialogDescription>
              {phase.kind === "imported"
                ? "Import complete."
                : phase.kind === "analyzed"
                ? `Found ${phase.analysis.candidates.length} skill${phase.analysis.candidates.length === 1 ? "" : "s"} in the zip. Pick which to import.`
                : "Pick a .zip containing one or more SKILL.md files. Each SKILL.md and its sibling files become a skill."}
            </DialogDescription>
          </DialogHeader>

          {phase.kind === "idle" && (
            <div className="space-y-3">
              <Input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_TYPES}
                onChange={handleFile}
                className="cursor-pointer"
                data-testid="zip-import-file-input"
              />
              <p className="text-[11px] text-muted-foreground">
                Maximum 50 MB uncompressed, 1 MB per ancillary file. Zips
                with more than 50 SKILL.md files are rejected.
              </p>
            </div>
          )}

          {phase.kind === "uploading" && (
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground py-6"
              data-testid="zip-import-uploading"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {phase.label}
            </div>
          )}

          {phase.kind === "analyzed" && (
            <AnalyzedView
              analysis={phase.analysis}
              selectedIds={phase.selectedIds}
              setSelectedIds={(next) =>
                setPhase((prev) =>
                  prev.kind === "analyzed"
                    ? { ...prev, selectedIds: next }
                    : prev,
                )
              }
              hasResolutions={phase.conflictResolutions !== null}
              onReopenConflicts={() =>
                setPhase((prev) =>
                  prev.kind === "analyzed"
                    ? { ...prev, showConflictDialog: true }
                    : prev,
                )
              }
            />
          )}

          {phase.kind === "imported" && (
            <ImportedView imported={phase.imported} />
          )}

          <DialogFooter>
            {phase.kind === "idle" && (
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
            )}
            {phase.kind === "analyzed" && (
              <>
                <Button variant="ghost" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={phase.selectedIds.size === 0}
                  data-testid="zip-import-confirm"
                >
                  Import {phase.selectedIds.size} skill
                  {phase.selectedIds.size === 1 ? "" : "s"}
                </Button>
              </>
            )}
            {phase.kind === "imported" && (
              <Button onClick={handleClose} data-testid="zip-import-done">
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {phase.kind === "analyzed" && phase.analysis.conflicts.length > 0 && (
        <ImportConflictDialog
          open={phase.showConflictDialog}
          conflicts={phase.analysis.conflicts}
          existingNames={[
            ...phase.analysis.conflicts.map((c) => c.existingName),
            ...phase.analysis.candidates.map((c) => c.proposedName),
          ]}
          title="Resolve duplicate skills"
          description={`${phase.analysis.conflicts.length} skill${phase.analysis.conflicts.length === 1 ? "" : "s"} in the zip already exist in your catalog.`}
          onResolve={handleConflictResolve}
          onCancel={handleConflictCancel}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Analyzed view: candidate checklist + conflict reopen affordance
// ---------------------------------------------------------------------------

interface AnalyzedViewProps {
  analysis: AnalyzeResponse;
  selectedIds: Set<string>;
  setSelectedIds: (next: Set<string>) => void;
  hasResolutions: boolean;
  onReopenConflicts: () => void;
}

function AnalyzedView({
  analysis,
  selectedIds,
  setSelectedIds,
  hasResolutions,
  onReopenConflicts,
}: AnalyzedViewProps) {
  const conflictById = useMemo(() => {
    const m = new Map<string, ImportConflictDecision>();
    for (const c of analysis.conflicts) m.set(c.candidateId, c);
    return m;
  }, [analysis.conflicts]);

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div className="space-y-2 flex-1 min-h-0 flex flex-col">
      {analysis.conflicts.length > 0 && (
        <div
          className={cn(
            "flex items-center justify-between rounded-md border px-3 py-2 text-xs",
            hasResolutions
              ? "border-emerald-500/40 bg-emerald-500/10"
              : "border-amber-500/40 bg-amber-500/10",
          )}
        >
          <span
            className={cn(
              "flex items-center gap-2",
              hasResolutions
                ? "text-emerald-900 dark:text-emerald-100"
                : "text-amber-900 dark:text-amber-100",
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {analysis.conflicts.length} duplicate name
            {analysis.conflicts.length === 1 ? "" : "s"} —{" "}
            {hasResolutions ? "resolved" : "pending"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            onClick={onReopenConflicts}
            data-testid="zip-import-reopen-conflicts"
          >
            {hasResolutions ? "Edit decisions" : "Resolve duplicates"}
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0 -mx-1">
        <ul className="space-y-1.5 px-1 py-1">
          {analysis.candidates.map((c) => {
            const conflict = conflictById.get(c.candidateId);
            const checked = selectedIds.has(c.candidateId);
            return (
              <li
                key={c.candidateId}
                className={cn(
                  "rounded-md border px-3 py-2 text-xs",
                  checked
                    ? "border-border/60 bg-muted/20"
                    : "border-border/40 bg-muted/5 opacity-60",
                )}
              >
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c.candidateId)}
                    className="mt-0.5 h-3.5 w-3.5 cursor-pointer"
                    data-testid={`zip-import-candidate-${c.candidateId}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="font-medium truncate">
                        {c.proposedName}
                      </span>
                      {conflict && (
                        <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          duplicate
                        </span>
                      )}
                    </div>
                    {c.description && (
                      <div className="text-[11px] text-muted-foreground line-clamp-2">
                        {c.description}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {c.directory || "(zip root)"} ·{" "}
                      {(c.bytes / 1024).toFixed(1)} KB
                      {c.ancillaryCount > 0 &&
                        ` · ${c.ancillaryCount} ancillary file${c.ancillaryCount === 1 ? "" : "s"}`}
                      {c.skippedFiles.length > 0 &&
                        ` · ${c.skippedFiles.length} skipped`}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Imported view: per-row outcome summary
// ---------------------------------------------------------------------------

function ImportedView({ imported }: { imported: ImportedRow[] }) {
  const counts = imported.reduce(
    (acc, r) => {
      acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  return (
    <div className="space-y-3 flex-1 min-h-0 flex flex-col">
      <div className="text-xs text-muted-foreground">
        {Object.entries(counts)
          .map(([k, v]) => `${v} ${k}`)
          .join(" · ")}
      </div>
      <ScrollArea className="flex-1 min-h-0 -mx-1">
        <ul className="space-y-1.5 px-1 py-1">
          {imported.map((r) => (
            <li
              key={`${r.candidateId}-${r.outcome}`}
              className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-xs"
            >
              <div className="flex items-start gap-2">
                {r.outcome === "failed" ? (
                  <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 mt-0.5",
                      r.scan_status === "flagged"
                        ? "text-amber-500"
                        : "text-emerald-500",
                    )}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.outcome}
                    {r.outcome !== "skipped" && r.outcome !== "failed" &&
                      ` · scan: ${r.scan_status}`}
                    {r.scan_summary && ` · ${r.scan_summary}`}
                    {r.error && ` · ${r.error}`}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
