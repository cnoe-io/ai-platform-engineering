"use client";

/**
 * GithubImportPanel — small inline form that POSTs to
 * `/api/skills/import-github` and hands the resulting
 * `{ filename: content }` map back to the caller via `onImported`.
 *
 * Used by the Workspace's Files tab. Matches the validation and error
 * surface previously inlined in `SkillsBuilderEditor`.
 */

import React, { useState } from "react";
import { GithubIcon } from "@/components/ui/icons";
import { Loader2, Import as ImportIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface GithubImportPanelProps {
  /** Called when the import succeeds with the map of imported files. */
  onImported: (files: Record<string, string>) => void;
  /** Called when the user dismisses the panel. */
  onClose?: () => void;
  className?: string;
}

export function GithubImportPanel({
  onImported,
  onClose,
  className,
}: GithubImportPanelProps) {
  const { toast } = useToast();
  const [repo, setRepo] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = !busy && repo.trim().length > 0 && path.trim().length > 0;

  const handleImport = async () => {
    setBusy(true);
    try {
      const resp = await fetch("/api/skills/import-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repo.trim(), path: path.trim() }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `Import failed: ${resp.status}`);
      }
      const data = await resp.json();
      const imported = (data.data?.files ?? data.files ?? {}) as Record<
        string,
        string
      >;
      const count = Object.keys(imported).length;
      onImported(imported);
      toast(`Imported ${count} file${count === 1 ? "" : "s"}`, "success");
      setRepo("");
      setPath("");
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
      data-testid="github-import-panel"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GithubIcon className="h-4 w-4" />
          Import from GitHub
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label
            htmlFor="gh-import-repo"
            className="text-[10px] text-muted-foreground mb-0.5 block"
          >
            Repository (owner/repo)
          </label>
          <Input
            id="gh-import-repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="anthropics/skills"
            className="h-8 text-xs"
            disabled={busy}
          />
        </div>
        <div>
          <label
            htmlFor="gh-import-path"
            className="text-[10px] text-muted-foreground mb-0.5 block"
          >
            Directory path
          </label>
          <Input
            id="gh-import-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="skills/pptx"
            className="h-8 text-xs"
            disabled={busy}
          />
        </div>
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
