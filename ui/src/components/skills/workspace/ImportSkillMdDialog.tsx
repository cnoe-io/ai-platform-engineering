"use client";

/**
 * ImportSkillMdDialog — modal for importing SKILL.md content from a local
 * file or pasted text. Replaces the legacy `ImportSkillMdPanel` overlay
 * used by SkillsBuilderEditor.
 *
 * Designed as a self-contained Dialog so it composes cleanly with the new
 * Workspace shell. Keeps the same import-only contract (`onImport(text)`).
 */

import React, { useCallback, useState } from "react";
import { Import as ImportIcon, Upload } from "lucide-react";
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
import { cn } from "@/lib/utils";

export interface ImportSkillMdDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the imported content when the user confirms. */
  onImport: (content: string) => void;
}

const MAX_BYTES = 1 * 1024 * 1024; // 1 MiB hard cap on pasted/uploaded text

export function ImportSkillMdDialog({
  open,
  onOpenChange,
  onImport,
}: ImportSkillMdDialogProps) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_BYTES) {
        setError(
          `File is too large (${(file.size / 1024).toFixed(0)} KB > 1024 KB).`,
        );
        return;
      }
      setError(null);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = (ev.target?.result as string) || "";
        setContent(text);
      };
      reader.onerror = () => setError("Failed to read file.");
      reader.readAsText(file);
    },
    [],
  );

  const handleConfirm = () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    if (new Blob([trimmed]).size > MAX_BYTES) {
      setError("Content is too large to import.");
      return;
    }
    onImport(trimmed);
    setContent("");
    setError(null);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setContent("");
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleCancel())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImportIcon className="h-4 w-4" />
            Import SKILL.md
          </DialogTitle>
          <DialogDescription>
            Upload a local <code>.md</code> file or paste SKILL.md content.
            Importing replaces the current editor content.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium mb-1 block">Upload file</label>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept=".md,.markdown,.txt"
                onChange={handleFile}
                className="cursor-pointer h-8 text-xs"
              />
              <Upload className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or paste
              </span>
            </div>
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={"---\nname: my-skill\ndescription: ...\n---\n\n# My Skill\n..."}
            rows={10}
            className={cn(
              "w-full px-3 py-2 text-xs rounded-md border border-input bg-background resize-none font-mono",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!content.trim()}>
            <ImportIcon className="h-3.5 w-3.5 mr-1.5" />
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
