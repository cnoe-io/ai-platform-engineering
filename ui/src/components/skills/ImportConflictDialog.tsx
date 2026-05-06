"use client";

/**
 * ImportConflictDialog — generic per-skill duplicate-resolution UI for
 * any "bulk import" flow (zip, repo, future marketplace).
 *
 * The dialog is intentionally framework-agnostic about the *source*
 * of the conflicts: callers hand it a list of `ImportConflictDecision`
 * rows and a callback. The dialog never fetches anything itself —
 * the parent component owns the data flow and re-runs the import
 * with the chosen resolutions when the user clicks Apply.
 *
 * Per-row UX:
 *   * A radio group with three options: Skip / Overwrite / Rename.
 *   * "Skip" is the default for every row (least destructive — a
 *     misclick on Apply doesn't cause data loss).
 *   * "Overwrite" surfaces an inline warning so the user understands
 *     the existing skill's content is replaced (a new revision is
 *     written first by the server, so the action is recoverable —
 *     the inline copy mentions that to soften the alarm).
 *   * "Rename" pre-fills with `${original} (imported)` (or
 *     `(imported N)` for further collisions) and lets the user edit.
 *
 * Bulk shortcuts:
 *   A single "Apply to all" row at the top sets the same action for
 *   every conflict at once. Useful when the user just wants "skip
 *   everything that already exists" or "rename everything", which
 *   is the dominant flow for re-running a previously-imported zip.
 */

import React, { useCallback, useMemo, useState, useEffect } from "react";
import { AlertTriangle, FileWarning } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  suggestRenamedSkillName,
  type ImportConflictAction,
  type ImportConflictDecision,
} from "@/lib/skill-import-helpers";

export interface ImportConflictDialogProps {
  open: boolean;
  /**
   * Initial conflict list. The dialog snapshots this on open into
   * its own local state (so transient prop churn from the parent's
   * fetch loop doesn't reset the user's edits).
   */
  conflicts: ImportConflictDecision[];
  /**
   * Names of existing skills, used to pre-suggest a unique rename
   * when the user picks "Rename". The set should already include
   * the conflicting names themselves so suggestions don't collide.
   */
  existingNames?: Iterable<string>;
  /**
   * Optional title override. Default: "Resolve duplicates".
   */
  title?: string;
  /**
   * Optional intro line shown above the conflict list. Default
   * mentions the count.
   */
  description?: string;
  /**
   * Called when the user clicks Apply. The argument is a fresh array
   * of decisions — every row is included exactly once and every
   * "rename" row has a non-empty `renameTo`.
   */
  onResolve: (decisions: ImportConflictDecision[]) => void;
  /**
   * Called when the user dismisses the dialog (Cancel or Esc / X).
   * Distinct from "Apply with all skip" — Cancel implies the whole
   * import should be aborted; the parent decides.
   */
  onCancel: () => void;
}

const ACTION_OPTIONS: Array<{
  value: ImportConflictAction;
  label: string;
  hint: string;
}> = [
  {
    value: "skip",
    label: "Skip",
    hint: "Leave the existing skill alone; this candidate is dropped.",
  },
  {
    value: "overwrite",
    label: "Overwrite",
    hint:
      "Replace the existing skill's content. The current state is captured as a new revision first so it can be restored.",
  },
  {
    value: "rename",
    label: "Import as new",
    hint: "Import the candidate as a new skill with a different name.",
  },
];

export function ImportConflictDialog({
  open,
  conflicts,
  existingNames,
  title = "Resolve duplicates",
  description,
  onResolve,
  onCancel,
}: ImportConflictDialogProps) {
  // Snapshot the props into local state on open so the user's
  // in-progress edits aren't clobbered if the parent re-renders.
  // We re-sync only when `open` flips from false → true.
  const [decisions, setDecisions] = useState<ImportConflictDecision[]>(
    () => seedDecisions(conflicts, existingNames),
  );
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  // Re-seed when the dialog is opened with a new set of conflicts.
  // We deliberately key on `open` rather than `conflicts` to avoid
  // resetting state on every parent re-render; the parent is
  // responsible for closing-then-opening if the conflict set
  // genuinely changed.
  useEffect(() => {
    if (open) {
      setDecisions(seedDecisions(conflicts, existingNames));
      setValidationErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const existingNamesSet = useMemo(() => {
    const s = new Set<string>();
    if (existingNames) {
      for (const n of existingNames) s.add(n);
    }
    return s;
  }, [existingNames]);

  // ---- Per-row mutation helpers -----------------------------------------
  const setActionFor = useCallback(
    (candidateId: string, action: ImportConflictAction) => {
      setDecisions((prev) =>
        prev.map((d) => {
          if (d.candidateId !== candidateId) return d;
          // When switching INTO rename and there's no suggestion
          // yet, generate one now. We re-run the suggester rather
          // than reusing the original because the user may have
          // previously edited and cleared the rename field.
          if (action === "rename" && !d.renameTo) {
            return {
              ...d,
              action,
              renameTo: suggestRenamedSkillName(
                d.candidateName,
                existingNamesSet,
              ),
            };
          }
          return { ...d, action };
        }),
      );
      setValidationErrors((prev) => {
        if (!prev[candidateId]) return prev;
        const { [candidateId]: _, ...rest } = prev;
        return rest;
      });
    },
    [existingNamesSet],
  );

  const setRenameFor = useCallback(
    (candidateId: string, renameTo: string) => {
      setDecisions((prev) =>
        prev.map((d) =>
          d.candidateId === candidateId ? { ...d, renameTo } : d,
        ),
      );
      // Clear validation as soon as the user types — re-validate on
      // Apply.
      setValidationErrors((prev) => {
        if (!prev[candidateId]) return prev;
        const { [candidateId]: _, ...rest } = prev;
        return rest;
      });
    },
    [],
  );

  // Bulk apply: set every row to the chosen action. For Rename we
  // re-suggest names so each row gets a fresh, collision-free name
  // rather than copying the same suffix everywhere.
  const setAllActions = useCallback(
    (action: ImportConflictAction) => {
      setDecisions((prev) =>
        prev.map((d) => {
          if (action === "rename") {
            return {
              ...d,
              action,
              renameTo: suggestRenamedSkillName(
                d.candidateName,
                existingNamesSet,
              ),
            };
          }
          return { ...d, action };
        }),
      );
      setValidationErrors({});
    },
    [existingNamesSet],
  );

  // ---- Apply ------------------------------------------------------------
  const handleApply = useCallback(() => {
    const errors: Record<string, string> = {};
    for (const d of decisions) {
      if (d.action !== "rename") continue;
      const trimmed = (d.renameTo || "").trim();
      if (!trimmed) {
        errors[d.candidateId] = "A new name is required.";
        continue;
      }
      // Block obvious self-collision: renaming into the existing
      // name defeats the point of the rename action.
      if (
        trimmed.toLowerCase() === d.existingName.trim().toLowerCase()
      ) {
        errors[d.candidateId] =
          "New name matches the existing skill — pick a different name.";
      }
    }
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }
    // Normalise whitespace on rename targets before handing back
    // — the import API will use whatever we emit verbatim.
    const finalised = decisions.map((d) =>
      d.action === "rename"
        ? { ...d, renameTo: (d.renameTo || "").trim() }
        : d,
    );
    onResolve(finalised);
  }, [decisions, onResolve]);

  const counts = useMemo(() => {
    const acc = { skip: 0, overwrite: 0, rename: 0 };
    for (const d of decisions) acc[d.action]++;
    return acc;
  }, [decisions]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="h-4 w-4 text-amber-500" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {description ??
              `${decisions.length} skill${decisions.length === 1 ? "" : "s"} in this import already exist. Choose what to do for each.`}
          </DialogDescription>
        </DialogHeader>

        {/* Bulk-apply row. Lives above the list so a user with 30
            conflicts can pick "skip all" once instead of clicking 30
            radios. */}
        <div className="flex items-center gap-2 border-b border-border/40 pb-2 text-xs">
          <span className="text-muted-foreground">Apply to all:</span>
          {ACTION_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => setAllActions(opt.value)}
              data-testid={`import-conflicts-apply-all-${opt.value}`}
            >
              {opt.label}
            </Button>
          ))}
          <span
            className="ml-auto text-[11px] text-muted-foreground"
            data-testid="import-conflicts-summary"
          >
            {counts.skip} skip · {counts.overwrite} overwrite ·{" "}
            {counts.rename} rename
          </span>
        </div>

        <ScrollArea className="flex-1 min-h-0 -mx-1">
          <ul className="space-y-2 px-1 py-1">
            {decisions.map((d) => (
              <ConflictRow
                key={d.candidateId}
                decision={d}
                error={validationErrors[d.candidateId]}
                onActionChange={(a) => setActionFor(d.candidateId, a)}
                onRenameChange={(v) => setRenameFor(d.candidateId, v)}
              />
            ))}
          </ul>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            data-testid="import-conflicts-cancel"
          >
            Cancel import
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            data-testid="import-conflicts-apply"
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Per-row component
// ---------------------------------------------------------------------------

interface ConflictRowProps {
  decision: ImportConflictDecision;
  error?: string;
  onActionChange: (action: ImportConflictAction) => void;
  onRenameChange: (value: string) => void;
}

function ConflictRow({
  decision,
  error,
  onActionChange,
  onRenameChange,
}: ConflictRowProps) {
  const groupName = `import-conflict-${decision.candidateId}`;
  return (
    <li className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            {decision.candidateName}
          </div>
          <div className="text-[11px] text-muted-foreground">
            collides with{" "}
            <span className="font-medium text-foreground/80">
              {decision.existingName}
            </span>
            {decision.existingId ? (
              <span className="font-mono"> ({decision.existingId})</span>
            ) : null}
          </div>
          {decision.summary ? (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {decision.summary}
            </div>
          ) : null}
        </div>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="sr-only">
          Resolution for {decision.candidateName}
        </legend>
        {ACTION_OPTIONS.map((opt) => {
          const id = `${groupName}-${opt.value}`;
          const checked = decision.action === opt.value;
          return (
            <div key={opt.value} className="flex items-start gap-2">
              <input
                id={id}
                type="radio"
                name={groupName}
                value={opt.value}
                checked={checked}
                onChange={() => onActionChange(opt.value)}
                className="mt-0.5 h-3.5 w-3.5 cursor-pointer"
                data-testid={`import-conflict-${decision.candidateId}-${opt.value}`}
              />
              <div className="min-w-0 text-xs">
                <Label
                  htmlFor={id}
                  className="cursor-pointer text-xs font-medium"
                >
                  {opt.label}
                </Label>
                <div className="text-[11px] text-muted-foreground">
                  {opt.hint}
                </div>
              </div>
            </div>
          );
        })}
      </fieldset>

      {/* Overwrite warning. Inline rather than a modal so the user
          stays in the bulk-resolution flow; the copy explicitly
          mentions the revision-history backstop so the warning
          doesn't read as a hard veto. */}
      {decision.action === "overwrite" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-900 dark:text-amber-100">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div>
            This will replace
            <span className="font-medium"> {decision.existingName}</span>
            &apos;s SKILL.md and ancillary files. The previous content
            is saved as a revision and can be restored from the
            Versions tab.
          </div>
        </div>
      )}

      {/* Rename input. Only rendered when the action is "rename" so
          we don't visually crowd the row with a disabled field. */}
      {decision.action === "rename" && (
        <div className="space-y-1">
          <Label
            htmlFor={`${groupName}-rename`}
            className="text-[11px]"
          >
            New name
          </Label>
          <Input
            id={`${groupName}-rename`}
            value={decision.renameTo ?? ""}
            onChange={(e) => onRenameChange(e.target.value)}
            placeholder="My imported skill"
            className={cn(
              "h-8 text-xs",
              error && "border-destructive focus-visible:ring-destructive",
            )}
            data-testid={`import-conflict-${decision.candidateId}-rename-input`}
            aria-invalid={!!error}
            aria-describedby={
              error ? `${groupName}-rename-error` : undefined
            }
          />
          {error && (
            <div
              id={`${groupName}-rename-error`}
              className="text-[11px] text-destructive"
            >
              {error}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedDecisions(
  conflicts: ImportConflictDecision[],
  existingNames: Iterable<string> | undefined,
): ImportConflictDecision[] {
  const taken = new Set<string>();
  if (existingNames) {
    for (const n of existingNames) taken.add(n);
  }
  // Also seed the suggester with already-suggested names from this
  // batch so two same-named candidates each get a unique fallback
  // (otherwise both would suggest "Foo (imported)" and one would
  // collide with the other on apply).
  return conflicts.map((c) => {
    const action = c.action ?? "skip";
    let renameTo = c.renameTo;
    if (action === "rename" && !renameTo) {
      renameTo = suggestRenamedSkillName(c.candidateName, taken);
      taken.add(renameTo);
    }
    return { ...c, action, renameTo };
  });
}
