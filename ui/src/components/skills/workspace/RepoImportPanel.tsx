"use client";

/**
 * RepoImportPanel — inline form that POSTs to `/api/skills/import` and
 * hands the resulting `{ filename: content }` map back to the caller via
 * `onImported`.
 *
 * Replaces the GitHub-only `GithubImportPanel`. Adds:
 *   - Source toggle (GitHub / GitLab) — default GitHub for back-compat
 *   - Multi-path support (1..5 prefixes), with `+ Add another path`
 *   - Source-aware placeholders + credentials hint
 *   - Non-blocking `conflicts` toast when first-wins drops a duplicate
 *     filename across two prefixes
 *
 * Per FR-019.
 */

import React, { useState } from "react";
import { GithubIcon, GitlabIcon } from "@/components/ui/icons";
import { Loader2, Import as ImportIcon, X, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type RepoImportSource = "github" | "gitlab";

const MAX_PATHS = 5;

const SOURCE_HINTS: Record<RepoImportSource, {
  repoLabel: string;
  repoPlaceholder: string;
  pathPlaceholder: string;
  credentialEnv: string;
}> = {
  github: {
    repoLabel: "Repository (owner/repo)",
    repoPlaceholder: "anthropics/skills",
    pathPlaceholder: "skills/pptx",
    credentialEnv: "GITHUB_TOKEN",
  },
  gitlab: {
    repoLabel: "Project (group/.../project)",
    repoPlaceholder: "mycorp/platform",
    pathPlaceholder: "skills/example",
    credentialEnv: "GITLAB_TOKEN",
  },
};

export interface RepoImportPanelProps {
  /** Called when the import succeeds with the merged map of imported files. */
  onImported: (files: Record<string, string>) => void;
  /** Called when the user dismisses the panel. */
  onClose?: () => void;
  className?: string;
  /** Override the initial source toggle position (default: "github"). */
  initialSource?: RepoImportSource;
}

interface ImportConflict {
  name: string;
  kept_from: string;
  dropped_from: string;
}

export function RepoImportPanel({
  onImported,
  onClose,
  className,
  initialSource = "github",
}: RepoImportPanelProps) {
  const { toast } = useToast();
  const [source, setSource] = useState<RepoImportSource>(initialSource);
  const [repo, setRepo] = useState("");
  const [paths, setPaths] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);

  const hint = SOURCE_HINTS[source];
  const trimmedPaths = paths.map((p) => p.trim()).filter((p) => p.length > 0);
  const canSubmit =
    !busy && repo.trim().length > 0 && trimmedPaths.length > 0;

  const handleAddPath = () => {
    if (paths.length >= MAX_PATHS) return;
    setPaths((prev) => [...prev, ""]);
  };

  const handlePathChange = (idx: number, value: string) => {
    setPaths((prev) => prev.map((p, i) => (i === idx ? value : p)));
  };

  const handleRemovePath = (idx: number) => {
    setPaths((prev) =>
      prev.length === 1 ? [""] : prev.filter((_, i) => i !== idx),
    );
  };

  const handleImport = async () => {
    setBusy(true);
    try {
      const resp = await fetch("/api/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          repo: repo.trim(),
          paths: trimmedPaths,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `Import failed: ${resp.status}`);
      }
      const data = await resp.json();
      const payload = (data.data ?? data) as {
        files?: Record<string, string>;
        conflicts?: ImportConflict[];
      };
      const imported = (payload.files ?? {}) as Record<string, string>;
      const conflicts = (payload.conflicts ?? []) as ImportConflict[];
      const count = Object.keys(imported).length;
      onImported(imported);
      if (conflicts.length > 0) {
        toast(
          `Imported ${count} file${count === 1 ? "" : "s"}; skipped ${conflicts.length} duplicate${conflicts.length === 1 ? "" : "s"}`,
          "success",
        );
      } else {
        toast(`Imported ${count} file${count === 1 ? "" : "s"}`, "success");
      }
      setRepo("");
      setPaths([""]);
      onClose?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast(`Import error: ${msg}`, "error", 5000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2",
        className,
      )}
      data-testid="repo-import-panel"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {source === "github" ? (
            <GithubIcon className="h-4 w-4" />
          ) : (
            <GitlabIcon className="h-4 w-4" />
          )}
          Import from repo
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Source toggle */}
      <div
        role="radiogroup"
        aria-label="Import source"
        className="inline-flex items-center rounded-md border border-border/60 bg-background p-0.5 text-xs"
      >
        {(["github", "gitlab"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={source === s}
            onClick={() => setSource(s)}
            disabled={busy}
            className={cn(
              "px-2.5 py-1 rounded font-medium capitalize transition-colors",
              source === s
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s === "github" ? "GitHub" : "GitLab"}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div>
          <label
            htmlFor="repo-import-repo"
            className="text-[10px] text-muted-foreground mb-0.5 block"
          >
            {hint.repoLabel}
          </label>
          <Input
            id="repo-import-repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder={hint.repoPlaceholder}
            className="h-8 text-xs"
            disabled={busy}
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="text-[10px] text-muted-foreground block"
            htmlFor="repo-import-path-0"
          >
            Directory paths{paths.length > 1 ? ` (${paths.length})` : ""}
          </label>
          {paths.map((value, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <Input
                id={`repo-import-path-${idx}`}
                aria-label={`Directory path ${idx + 1}`}
                value={value}
                onChange={(e) => handlePathChange(idx, e.target.value)}
                placeholder={hint.pathPlaceholder}
                className="h-8 text-xs"
                disabled={busy}
              />
              {paths.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => handleRemovePath(idx)}
                  aria-label={`Remove path ${idx + 1}`}
                  disabled={busy}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          {paths.length < MAX_PATHS && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] gap-1 px-2"
              onClick={handleAddPath}
              disabled={busy}
            >
              <Plus className="h-3 w-3" />
              Add another path
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Token resolved from{" "}
          <code className="font-mono">{hint.credentialEnv}</code>. Public
          repos work without one.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1"
          disabled={!canSubmit}
          onClick={handleImport}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ImportIcon className="h-3 w-3" />
          )}
          Import
        </Button>
      </div>
    </div>
  );
}
