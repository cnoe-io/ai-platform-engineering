"use client";

/**
 * SkillMdEditor — opinionated SKILL.md editor used by both the Workspace
 * Files tab and (eventually) the SkillFolderViewer when the open file is
 * `SKILL.md`.
 *
 * Responsibilities on top of `RichCodeEditor`:
 *   - Forces markdown language support (ignores filename heuristics)
 *   - Lints the YAML frontmatter (missing fields, malformed delimiters)
 *   - Lints the body for `{{variable}}` references that aren't declared in
 *     the metadata `inputVariables` list (warning, not error)
 *   - Toolbar with Undo / Redo / Download / soft-wrap toggle
 *
 * The component is fully controlled via the `value` / `onChange` pair so
 * it composes with `useSkillForm`'s `setSkillContentAndSyncTools` (which
 * needs to fire on every change to keep `allowedTools` in sync with the
 * frontmatter).
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Columns2,
  Download,
  Eye,
  Pencil,
  Redo2,
  Undo2,
  WrapText,
} from "lucide-react";
import {
  RichCodeEditor,
  cmRedo,
  cmUndo,
  type Diagnostic,
  type ReactCodeMirrorRef,
} from "@/components/skills/workspace/RichCodeEditor";
import { SkillMdPreview } from "@/components/skills/workspace/SkillMdPreview";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseSkillMd } from "@/lib/skill-md-parser";
import type { SkillInputVariable } from "@/types/agent-skill";

/**
 * Three view modes match what the previous editor offered:
 *   - "edit"    → CodeMirror only (default)
 *   - "split"   → CodeMirror | rendered preview, side-by-side
 *   - "preview" → rendered preview only (read-only)
 *
 * In `readOnly` skills we still allow the toggle so users can flip to
 * the source view to see frontmatter.
 */
export type SkillMdViewMode = "edit" | "split" | "preview";

export interface SkillMdEditorProps {
  /** Markdown source. Controlled. */
  value: string;
  /** Called on every edit. */
  onChange: (next: string) => void;

  /**
   * Variables declared in metadata; used to lint `{{var}}` references in
   * the body. Optional — when omitted, no `{{...}}` linting runs.
   */
  declaredVariables?: SkillInputVariable[];

  /** Skill name for the Download default filename. */
  skillName?: string;

  /** Editor is not editable. Toolbar shows but actions disabled. */
  readOnly?: boolean;

  /** Editor min height. Default: "320px". */
  minHeight?: string;
  /** Editor max height. Default: "70vh". */
  maxHeight?: string;
  /** Force a fixed height (overrides min/max). */
  height?: string;

  /** Hide the toolbar (useful inside a panel that already has its own). */
  hideToolbar?: boolean;

  className?: string;
}

// ---------------------------------------------------------------------------
// Lint sources
// ---------------------------------------------------------------------------

/**
 * Build a CodeMirror lint source that flags:
 *   - missing/unterminated frontmatter
 *   - missing required `name` key in frontmatter
 *   - `{{variable}}` references in the body not present in `declared`
 *
 * Diagnostics use 0-based offsets into the document.
 */
function buildSkillMdLintSource(
  declared: SkillInputVariable[] | undefined,
): (doc: string) => Diagnostic[] {
  const declaredNames = new Set((declared || []).map((v) => v.name));

  return (doc: string): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];

    // ---- Frontmatter ----
    if (doc.startsWith("---\n")) {
      const closeIdx = doc.indexOf("\n---", 4);
      if (closeIdx === -1) {
        diagnostics.push({
          from: 0,
          to: Math.min(doc.length, 4),
          severity: "error",
          message:
            "Frontmatter is not closed — expected a `---` delimiter on its own line before the body.",
        });
      } else {
        const fm = doc.slice(4, closeIdx);
        if (!/^name\s*:/m.test(fm)) {
          diagnostics.push({
            from: 0,
            to: Math.min(doc.length, 4),
            severity: "warning",
            message: "Frontmatter is missing a `name:` field.",
          });
        }
      }
    } else if (doc.trim().length > 0) {
      diagnostics.push({
        from: 0,
        to: Math.min(doc.length, 1),
        severity: "warning",
        message:
          "SKILL.md should start with a YAML frontmatter block (`---`) declaring `name:` and `description:`.",
      });
    }

    // ---- Variable references ----
    if (declared !== undefined) {
      const re = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(doc)) !== null) {
        const name = match[1];
        if (!declaredNames.has(name)) {
          diagnostics.push({
            from: match.index,
            to: match.index + match[0].length,
            severity: "warning",
            message: `Variable {{${name}}} is referenced but not declared in the skill's input variables.`,
          });
        }
      }
    }

    // ---- Optional: try the project parser; if it throws, surface it ----
    try {
      parseSkillMd(doc);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to parse SKILL.md";
      diagnostics.push({
        from: 0,
        to: Math.min(doc.length, 4),
        severity: "error",
        message: msg,
      });
    }

    return diagnostics;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillMdEditor({
  value,
  onChange,
  declaredVariables,
  skillName,
  readOnly = false,
  minHeight = "320px",
  maxHeight = "70vh",
  height,
  hideToolbar = false,
  className,
}: SkillMdEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef | null>(null);
  const [wrap, setWrap] = useState(false);
  // Default to "edit" so the editor opens to a familiar CodeMirror
  // surface; users can opt into split/preview from the toolbar.
  const [viewMode, setViewMode] = useState<SkillMdViewMode>("edit");

  const lintSource = useMemo(
    () => buildSkillMdLintSource(declaredVariables),
    [declaredVariables],
  );

  const handleUndo = useCallback(() => {
    const view = editorRef.current?.view;
    if (view) cmUndo(view);
  }, []);

  const handleRedo = useCallback(() => {
    const view = editorRef.current?.view;
    if (view) cmRedo(view);
  }, []);

  const handleDownload = useCallback(() => {
    const fileName = skillName
      ? `${skillName.toLowerCase().replace(/\s+/g, "-")}-SKILL.md`
      : "SKILL.md";
    const blob = new Blob([value], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [value, skillName]);

  // Editing-only controls (Undo/Redo/Wrap) are disabled when the user
  // is in pure "preview" mode — there's no visible CodeMirror to act on.
  const editingDisabled = readOnly || viewMode === "preview";

  const showEditor = viewMode !== "preview";
  const showPreview = viewMode !== "edit";

  // Body layout. We use a simple grid so split mode stays balanced even
  // at narrow widths (each pane gets `min-w-0` so CodeMirror's
  // horizontal scroll doesn't blow out the column).
  const bodyClass = cn(
    "flex-1 min-h-0",
    showEditor && showPreview
      ? "grid grid-cols-1 md:grid-cols-2 gap-2"
      : "flex",
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        // When a fixed `height` is supplied (e.g. the FilesTab passes
        // "100%"), let the body fill the parent so split mode actually
        // gets vertical space to render in.
        height && "h-full",
        className,
      )}
    >
      {!hideToolbar && (
        <div
          className="flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-2 py-1"
          data-skill-md-toolbar
        >
          {/* View-mode segmented toggle. Lives on the LEFT so it's the
              first thing authors see when they open SKILL.md — the
              previous editor put preview here too, so we preserve the
              muscle memory. */}
          <div
            className="inline-flex items-center rounded-md border border-border/50 bg-background p-0.5"
            role="group"
            aria-label="Editor view mode"
            data-testid="skill-md-view-toggle"
          >
            <Button
              type="button"
              variant={viewMode === "edit" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => setViewMode("edit")}
              aria-pressed={viewMode === "edit"}
              data-testid="skill-md-view-edit"
              title="Edit only"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
            <Button
              type="button"
              variant={viewMode === "split" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => setViewMode("split")}
              aria-pressed={viewMode === "split"}
              data-testid="skill-md-view-split"
              title="Edit + live preview"
            >
              <Columns2 className="h-3 w-3" />
              Split
            </Button>
            <Button
              type="button"
              variant={viewMode === "preview" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => setViewMode("preview")}
              aria-pressed={viewMode === "preview"}
              data-testid="skill-md-view-preview"
              title="Preview only"
            >
              <Eye className="h-3 w-3" />
              Preview
            </Button>
          </div>

          <div className="flex-1" />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleUndo}
            disabled={editingDisabled}
            title="Undo (⌘Z)"
            aria-label="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleRedo}
            disabled={editingDisabled}
            title="Redo (⌘⇧Z)"
            aria-label="Redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <div className="h-4 w-px bg-border/50 mx-1" />
          <Button
            type="button"
            variant={wrap ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setWrap((w) => !w)}
            disabled={viewMode === "preview"}
            title={wrap ? "Disable soft wrap" : "Enable soft wrap"}
            aria-label="Toggle soft wrap"
            aria-pressed={wrap}
          >
            <WrapText className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleDownload}
            title="Download SKILL.md"
            aria-label="Download SKILL.md"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div className={bodyClass}>
        {showEditor && (
          <div className="min-w-0 min-h-0 flex-1">
            <RichCodeEditor
              editorRef={editorRef}
              value={value}
              onChange={onChange}
              language="markdown"
              readOnly={readOnly}
              wrap={wrap}
              lintSource={lintSource}
              minHeight={minHeight}
              maxHeight={maxHeight}
              height={height}
            />
          </div>
        )}
        {showPreview && (
          <div
            className={cn(
              "min-w-0 min-h-0 flex-1 overflow-hidden rounded-md border border-border/50",
              // Match the editor's height envelope so split mode lines
              // up nicely.
              !height && "max-h-[70vh]",
            )}
          >
            <SkillMdPreview
              source={value}
              declaredVariables={declaredVariables}
            />
          </div>
        )}
      </div>
    </div>
  );
}
