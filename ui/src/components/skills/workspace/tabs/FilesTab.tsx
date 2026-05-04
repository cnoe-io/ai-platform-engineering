"use client";

/**
 * FilesTab — VS Code-style multi-file editing surface for the Workspace.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Toolbar: Templates | Import.md | GitHub | AI Assist | Add | Up.. │
 *   ├──────────────┬───────────────────────────────────────────────────┤
 *   │ File tree    │ Editor (rich, language auto-detected)             │
 *   │  ▸ SKILL.md  │                                                   │
 *   │  ▸ a.json    │                                                   │
 *   │  ▸ tools.py  │                                                   │
 *   └──────────────┴───────────────────────────────────────────────────┘
 *
 * Both panes are entirely client-side. Ancillary file imports drop into
 * `form.ancillaryFiles`; the actual save round-trips to the API only when
 * the user clicks "Save" (handled by `useSkillForm.handleSubmit`).
 *
 * Drag-and-drop and the "Upload" button accept multiple text files. Binary
 * files are rejected with a toast (we'd need to switch the form's storage
 * model to base64 to support them — out of scope for this stage).
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Upload as UploadIcon,
  Variable as VariableIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { RichCodeEditor } from "@/components/skills/workspace/RichCodeEditor";
import { SkillMdEditor } from "@/components/skills/workspace/SkillMdEditor";
import { SkillTemplatesMenu } from "@/components/skills/workspace/SkillTemplatesMenu";
import { ImportSkillMdDialog } from "@/components/skills/workspace/ImportSkillMdDialog";
import { GithubImportPanel } from "@/components/skills/workspace/GithubImportPanel";
import { SkillFileTree } from "@/components/skills/workspace/SkillFileTree";
import { AiAssistButton } from "@/components/ai-assist";
import { parseSkillMd } from "@/lib/skill-md-parser";
// Variables editor is now hosted inside FilesTab as a collapsible
// side-panel (toggled from the toolbar) so authors can declare
// `{{name}}` references without leaving the SKILL.md editor. The
// stand-alone Variables wizard step was removed in the same change.
import { VariablesTab } from "@/components/skills/workspace/tabs/VariablesTab";
import { extractPromptVariables } from "@/types/agent-skill";

import type { UseSkillFormResult } from "@/components/skills/workspace/use-skill-form";

const SKILL_MD = "SKILL.md";

/** Per-file size cap (1 MiB). The combined cap is enforced by the form. */
const MAX_FILE_BYTES = 1 * 1024 * 1024;
const MAX_FILE_COUNT = 64;

const TEXT_EXTENSIONS = new Set([
  "md",
  "mdx",
  "txt",
  "json",
  "yaml",
  "yml",
  "toml",
  "py",
  "js",
  "jsx",
  "ts",
  "tsx",
  "sh",
  "bash",
  "zsh",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "go",
  "rs",
  "java",
  "rb",
  "php",
  "sql",
  "xml",
  "csv",
  "ini",
  "cfg",
  "conf",
  "env",
  "lock",
  "gitignore",
  "dockerignore",
]);

function isLikelyTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return true; // dotless files like "Dockerfile"
  const ext = lower.slice(dot + 1);
  return TEXT_EXTENSIONS.has(ext);
}

export interface FilesTabProps {
  form: UseSkillFormResult;
  /** True for built-in/hub skills the user shouldn't edit. */
  readOnly?: boolean;
}

export function FilesTab({ form, readOnly = false }: FilesTabProps) {
  const { toast } = useToast();
  const [showImport, setShowImport] = useState(false);
  const [showGithubImport, setShowGithubImport] = useState(false);
  // Variables panel is opened from the toolbar (or auto-opens when there
  // are undeclared `{{var}}` references in SKILL.md — see effect below).
  const [showVariables, setShowVariables] = useState(false);
  const [selected, setSelected] = useState<string>(SKILL_MD);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Count of `{{name}}` references in SKILL.md that aren't declared
  // as input variables. Surfaced as a small badge on the "Variables"
  // toolbar toggle so authors notice when their template references
  // something the runtime can't resolve.
  const missingVariableCount = useMemo(() => {
    const declared = new Set(form.inputVariables.map((v) => v.name));
    const referenced = extractPromptVariables(form.skillContent).map(
      (v) => v.name,
    );
    let count = 0;
    for (const name of referenced) if (!declared.has(name)) count += 1;
    return count;
  }, [form.skillContent, form.inputVariables]);

  // ---------------------------------------------------------------------
  // Toolbar handlers (Templates / Import / GitHub / AI)
  // ---------------------------------------------------------------------

  const handleTemplate = useCallback(
    (tpl: { id: string; name: string; content: string; description?: string }) => {
      form.setSkillContentAndSyncTools(tpl.content);
      form.setFormData((prev) => ({
        ...prev,
        name: prev.name || tpl.name,
        description: prev.description || tpl.description || "",
      }));
      setSelected(SKILL_MD);
      toast(`Template "${tpl.name}" loaded`, "success");
    },
    [form, toast],
  );

  const handleImportMd = useCallback(
    (content: string) => {
      form.setSkillContentAndSyncTools(content);
      setSelected(SKILL_MD);
      toast("SKILL.md imported", "success");
    },
    [form, toast],
  );

  const handleGithubImported = useCallback(
    (files: Record<string, string>) => {
      const next = { ...files };
      const skillMd = next["SKILL.md"] ?? next["skill.md"];
      if (skillMd) {
        form.setSkillContentAndSyncTools(skillMd);
        delete next["SKILL.md"];
        delete next["skill.md"];
      }
      form.setAncillaryFiles((prev) => ({ ...prev, ...next }));
    },
    [form],
  );

  const handleApplyAi = useCallback(
    (
      next: string,
      parsed: { name?: string; title?: string; description?: string } | null,
    ) => {
      form.setSkillContentAndSyncTools(next);
      if (parsed?.name) {
        form.setFormData((prev) => ({
          ...prev,
          name: parsed.title || parsed.name || prev.name,
          description: parsed.description || prev.description,
        }));
      }
      setSelected(SKILL_MD);
    },
    [form],
  );

  // ---------------------------------------------------------------------
  // File tree handlers
  // ---------------------------------------------------------------------

  const handleAddFile = useCallback(
    (name: string) => {
      // Sanitise:
      //  • Normalise Windows-style separators to POSIX so a tree like
      //    `examples\onboard.md` gets stored as `examples/onboard.md`.
      //  • Collapse `.` / `..` segments and any leading slashes that
      //    would otherwise let the file "escape" the skill root.
      //  • Reject empty / dotfile-only segments.
      // Path separators are now preserved so users can mirror the
      // upstream folder layout (e.g. `templates/runbook.md`,
      // `prompts/system.md`) instead of being forced into a flat list.
      const segments = name
        .replace(/\\/g, "/")
        .split("/")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s !== "." && s !== "..");
      const clean = segments.join("/").replace(/^\.+/, "");
      if (!clean) {
        toast("Invalid path", "warning");
        return;
      }
      if (clean === SKILL_MD || form.ancillaryFiles[clean] !== undefined) {
        setSelected(clean);
        return;
      }
      form.setAncillaryFiles((prev) => ({ ...prev, [clean]: "" }));
      setSelected(clean);
    },
    [form, toast],
  );

  const handleDeleteFile = useCallback(
    (name: string) => {
      form.setAncillaryFiles((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      if (selected === name) setSelected(SKILL_MD);
    },
    [form, selected],
  );

  // ---------------------------------------------------------------------
  // File upload (drag-drop + button)
  // ---------------------------------------------------------------------

  const ingestFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (!arr.length) return;
      if (arr.length > MAX_FILE_COUNT) {
        toast(`Too many files (max ${MAX_FILE_COUNT}).`, "warning", 4000);
        return;
      }

      const next: Record<string, string> = {};
      let imported = 0;
      let replaced = 0;
      const skipped: string[] = [];

      for (const file of arr) {
        // Preserve folder structure when the user uploads via a
        // <input webkitdirectory> picker or drags a folder in. The
        // browser exposes the relative path on `webkitRelativePath`
        // (and HTML5 dataTransfer entries — handled by the caller for
        // drops). We strip the top-level folder name (e.g. "skill/")
        // so a dragged "skill/" directory lands as `templates/x.md`,
        // `prompts/y.md`, … rather than `skill/templates/x.md`.
        const rawPath =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name;
        const normalised = rawPath
          .replace(/\\/g, "/")
          .split("/")
          .filter((s) => s && s !== "." && s !== "..")
          .slice(rawPath.includes("/") ? 1 : 0)
          .join("/");
        const targetPath = normalised || file.name;
        if (file.size > MAX_FILE_BYTES) {
          skipped.push(`${targetPath} (too large)`);
          continue;
        }
        if (!isLikelyTextFile(file.name)) {
          skipped.push(`${targetPath} (binary)`);
          continue;
        }
        try {
          const text = await file.text();
          const baseName = targetPath.split("/").pop() || targetPath;
          const isSkillMd =
            baseName === SKILL_MD || baseName.toLowerCase() === "skill.md";
          if (isSkillMd) {
            // Confirm replacement of SKILL.md
            if (
              form.skillContent.trim() &&
              typeof window !== "undefined" &&
              !window.confirm(
                "Replace the current SKILL.md with the uploaded file?",
              )
            ) {
              skipped.push(`${targetPath} (kept current)`);
              continue;
            }
            form.setSkillContentAndSyncTools(text);
            replaced += 1;
          } else {
            next[targetPath] = text;
            imported += 1;
          }
        } catch {
          skipped.push(`${targetPath} (read error)`);
        }
      }

      if (Object.keys(next).length > 0) {
        form.setAncillaryFiles((prev) => ({ ...prev, ...next }));
      }

      const msgParts: string[] = [];
      if (imported) msgParts.push(`Imported ${imported}`);
      if (replaced) msgParts.push(`Replaced SKILL.md`);
      if (msgParts.length) toast(msgParts.join(" · "), "success");
      if (skipped.length) {
        toast(`Skipped: ${skipped.join(", ")}`, "warning", 6000);
      }
    },
    [form, toast],
  );

  const onUploadButton = () => fileInputRef.current?.click();
  const onUploadInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      void ingestFiles(e.target.files);
      e.target.value = "";
    }
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (readOnly) return;
      const items = e.dataTransfer.files;
      if (items?.length) void ingestFiles(items);
    },
    [ingestFiles, readOnly],
  );

  // ---------------------------------------------------------------------
  // Editor for the selected file
  // ---------------------------------------------------------------------

  const editorPane = useMemo(() => {
    if (selected === SKILL_MD) {
      return (
        <SkillMdEditor
          value={form.skillContent}
          onChange={(next) => form.setSkillContentAndSyncTools(next)}
          declaredVariables={form.inputVariables}
          skillName={form.formData.name || undefined}
          readOnly={readOnly}
          height="100%"
        />
      );
    }
    const value = form.ancillaryFiles[selected] ?? "";
    return (
      <RichCodeEditor
        value={value}
        filename={selected}
        readOnly={readOnly}
        onChange={(next) =>
          form.setAncillaryFiles((prev) => ({ ...prev, [selected]: next }))
        }
        height="100%"
      />
    );
  }, [selected, form, readOnly]);

  return (
    <div
      className="flex flex-col gap-2 h-full min-h-0"
      onDragOver={(e) => {
        if (readOnly) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {/* Hidden file input used by the Upload button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={onUploadInputChange}
        className="hidden"
        aria-hidden
        data-testid="files-tab-upload-input"
      />

      {/* Toolbar — actions only. The "Files" word that used to anchor
          this row was redundant with the file-tree column header below
          and the global wizard step label "Files" in the stepper, so
          we dropped it to give the row to the actions and the editor
          below a couple more pixels of vertical space. */}
      <div className="flex flex-wrap items-center justify-end gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1">
        {!readOnly && (
          <>
            <SkillTemplatesMenu onSelect={handleTemplate} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setShowImport(true)}
            >
              <UploadIcon className="h-3.5 w-3.5" />
              Import .md
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setShowGithubImport((v) => !v)}
              aria-pressed={showGithubImport}
            >
              GitHub
            </Button>
            <Button
              type="button"
              variant={showVariables ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setShowVariables((v) => !v)}
              aria-pressed={showVariables}
              aria-label="Toggle input variables panel"
              data-testid="files-tab-variables-toggle"
            >
              <VariableIcon className="h-3.5 w-3.5" />
              Variables
              {form.inputVariables.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 h-4 px-1 text-[10px] tabular-nums"
                >
                  {form.inputVariables.length}
                </Badge>
              )}
              {missingVariableCount > 0 && (
                <Badge
                  variant="outline"
                  className="ml-1 h-4 px-1 text-[10px] tabular-nums border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  title={`${missingVariableCount} variable${missingVariableCount === 1 ? "" : "s"} referenced in SKILL.md but not declared`}
                >
                  !{missingVariableCount}
                </Badge>
              )}
            </Button>
            {/* One AI Assist popover covers both modes: it sends the
                `enhance-skill-md` task when the editor already has
                content (so the user gets a diff against current
                SKILL.md), and falls back to `skill-md` when the
                editor is empty (a fresh generation). The popover
                header reflects whichever task was actually used. */}
            <AiAssistButton
              task="skill-md"
              resolveTask={(ctx) =>
                (ctx.current_value ?? "").trim().length > 0
                  ? "enhance-skill-md"
                  : "skill-md"
              }
              triggerTestId="files-tab-ai-assist"
              label="AI Assist"
              getContext={() => ({
                current_value: form.skillContent,
                name: form.formData.name,
                skill_description: form.formData.description,
              })}
              onApply={(text) => handleApplyAi(text, parseSkillMd(text))}
              presets={[
                "Add a step-by-step Instructions section",
                "Add Examples and Output Format sections",
                "Tighten the wording",
              ]}
            />
          </>
        )}
      </div>

      {/* GitHub import panel (collapsible) */}
      {!readOnly && showGithubImport && (
        <GithubImportPanel
          onImported={handleGithubImported}
          onClose={() => setShowGithubImport(false)}
        />
      )}

      {/* AI Assist no longer renders a collapsible panel here — the
          generic <AiAssistButton> popovers in the toolbar (Generate /
          Enhance) replace it. The legacy SkillAiAssistPanel +
          useSkillAiAssist still exist but are unused by this tab; they
          will be deleted once no other surface depends on them. */}

      {/* Variables panel (collapsible) — full VariablesTab content
          rendered inside a bordered card so it sits in the same vertical
          flow as the other authoring panels (GitHub, AI Assist). The
          stand-alone Variables wizard step was retired in favour of this
          inline UX so authors stay in the SKILL.md editor while declaring
          inputs that the template references. */}
      {showVariables && (
        <div
          className="rounded-md border border-border/60 bg-background p-3 shrink-0 max-h-[40vh] overflow-y-auto"
          data-testid="files-tab-variables-panel"
        >
          <VariablesTab form={form} />
        </div>
      )}

      {/* Editor area: tree | editor */}
      <div
        className={cn(
          "flex-1 min-h-0 grid grid-cols-[200px_1fr] rounded-md border border-border/60 overflow-hidden bg-background",
          dragOver && "ring-2 ring-primary",
        )}
      >
        <SkillFileTree
          ancillaryFiles={form.ancillaryFiles}
          selected={selected}
          onSelect={setSelected}
          onAddFile={handleAddFile}
          onDeleteFile={handleDeleteFile}
          onTriggerUpload={readOnly ? undefined : onUploadButton}
          readOnly={readOnly}
          className="border-r border-border/50 bg-muted/20"
        />
        <div className="min-h-0 overflow-auto p-2 relative">
          {dragOver && (
            <div className="absolute inset-2 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary pointer-events-none">
              Drop files to add to this skill
            </div>
          )}
          {editorPane}
        </div>
      </div>

      {/* Footer: ancillary size / limit warning */}
      {form.ancillaryOverLimit && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Total ancillary files exceed the 1 MiB limit. Save will fail until
          you remove or trim some files.
        </div>
      )}

      <ImportSkillMdDialog
        open={showImport}
        onOpenChange={setShowImport}
        onImport={handleImportMd}
      />
    </div>
  );
}
