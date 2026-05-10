"use client";

/**
 * SkillFileTree — left-rail file list for the Workspace Files tab.
 *
 * Displays SKILL.md (always pinned at top) plus every entry in the form's
 * `ancillaryFiles` map. Selecting a node fires `onSelect(name)`. The
 * "New file" button opens an inline path prompt and creates an empty
 * entry the user can edit; nested paths like `examples/onboard.md` are
 * preserved verbatim so callers can mirror the directory layout of the
 * upstream skill folder. The trash icon deletes ancillary files (the
 * SKILL.md row is never deletable).
 */

import React, { useMemo, useRef, useState } from "react";
import {
  FileCode,
  FileText,
  FileType,
  Image as ImageIcon,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SkillFileTreeProps {
  /** Map of ancillary filename → content. */
  ancillaryFiles: Record<string, string>;
  /** Currently-selected filename (`SKILL.md` is the implicit default). */
  selected: string;
  onSelect: (name: string) => void;
  /** Add a new empty ancillary file. */
  onAddFile: (name: string) => void;
  /** Delete an ancillary file. */
  onDeleteFile: (name: string) => void;
  /** Open the file-upload picker (handled by the parent). */
  onTriggerUpload?: () => void;
  /** Read-only mode hides Add/Delete affordances. */
  readOnly?: boolean;
  className?: string;
}

const SKILL_MD = "SKILL.md";

function iconFor(name: string): React.ElementType {
  const lower = name.toLowerCase();
  if (lower === "skill.md" || lower.endsWith(".md") || lower.endsWith(".mdx"))
    return FileText;
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".svg")
  )
    return ImageIcon;
  if (
    lower.endsWith(".json") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".toml")
  )
    return FileType;
  return FileCode;
}

export function SkillFileTree({
  ancillaryFiles,
  selected,
  onSelect,
  onAddFile,
  onDeleteFile,
  onTriggerUpload,
  readOnly = false,
  className,
}: SkillFileTreeProps) {
  // "New file" UI was previously a tiny inline `<Input>` jammed into a
  // tree row, which made the path placeholder almost invisible and gave
  // no room to communicate that drag-and-drop / upload are also valid
  // ways to add files. It's now a popover anchored to the `+` button so
  // there's room for a clear label, an example path, and an "Upload
  // instead" shortcut. Drag-and-drop is hinted in the popover footer
  // (the actual drop target lives in FilesTab — the editor pane).
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const entries = useMemo(() => {
    const names = Object.keys(ancillaryFiles).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    return names;
  }, [ancillaryFiles]);

  const closeAdd = () => {
    setAddOpen(false);
    setNewName("");
  };

  const submitAdd = () => {
    const name = newName.trim();
    if (!name) {
      closeAdd();
      return;
    }
    if (name === SKILL_MD || ancillaryFiles[name] !== undefined) {
      // Silent collision — caller's already-validated path is preferred,
      // but we don't trust the in-line input for uniqueness.
      onSelect(name);
      closeAdd();
      return;
    }
    onAddFile(name);
    closeAdd();
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden",
        className,
      )}
      data-testid="skill-file-tree"
    >
      <div className="shrink-0 border-b border-border/50 bg-muted/40 px-2 py-1.5 flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Files
        </span>
        {!readOnly && (
          <div className="flex items-center gap-0.5">
            {onTriggerUpload && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onTriggerUpload}
                title="Upload files (or drag and drop into the editor)"
                aria-label="Upload files"
              >
                <Upload className="h-3 w-3" />
              </Button>
            )}
            <Popover
              open={addOpen}
              onOpenChange={(o) => {
                if (o) {
                  setAddOpen(true);
                  // Defer focus until after the popover content renders.
                  setTimeout(() => inputRef.current?.focus(), 0);
                } else {
                  closeAdd();
                }
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="New file"
                  aria-label="New file"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="bottom"
                className="w-72 p-3"
                data-testid="skill-file-tree-new-file-popover"
              >
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitAdd();
                  }}
                  className="space-y-2"
                >
                  <div className="space-y-1">
                    <label
                      htmlFor="skill-file-tree-new-file-input"
                      className="text-[11px] font-semibold text-foreground"
                    >
                      New file path
                    </label>
                    <Input
                      id="skill-file-tree-new-file-input"
                      ref={inputRef}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        // Handle Enter explicitly (in addition to the
                        // surrounding `<form onSubmit>`) so JSDOM-based
                        // tests using `fireEvent.keyDown` work — JSDOM
                        // does not synthesise a submit from a bare
                        // keydown on the input.
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submitAdd();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          closeAdd();
                        }
                      }}
                      placeholder="path/to/file.md"
                      className="h-8 text-xs font-mono"
                      aria-label="New file path"
                    />
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      Use <span className="font-mono">/</span> to nest into folders, e.g.{" "}
                      <span className="font-mono">examples/onboard.md</span>.
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    {onTriggerUpload ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          closeAdd();
                          onTriggerUpload();
                        }}
                        title="Pick existing files from disk (or drag and drop into the editor)"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Upload instead
                      </Button>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={closeAdd}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        className="h-7 px-2.5 text-[11px]"
                        disabled={!newName.trim()}
                      >
                        Create
                      </Button>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground/80 border-t border-border/50 pt-2 mt-1">
                    Tip: you can also drag files (or a whole folder) onto the
                    editor to add them.
                  </p>
                </form>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      <ul className="flex-1 overflow-auto py-1 text-xs" role="tree">
        {/* Pinned SKILL.md */}
        <FileRow
          name={SKILL_MD}
          selected={selected === SKILL_MD}
          onSelect={() => onSelect(SKILL_MD)}
          // never deletable
          icon={FileText}
        />
        {entries.map((name) => (
          <FileRow
            key={name}
            name={name}
            selected={selected === name}
            onSelect={() => onSelect(name)}
            onDelete={
              readOnly
                ? undefined
                : () => {
                    if (
                      typeof window !== "undefined" &&
                      window.confirm(`Remove ${name}?`)
                    ) {
                      onDeleteFile(name);
                    }
                  }
            }
            icon={iconFor(name)}
          />
        ))}
      </ul>
    </div>
  );
}

interface FileRowProps {
  name: string;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  icon: React.ElementType;
}

function FileRow({ name, selected, onSelect, onDelete, icon: Icon }: FileRowProps) {
  return (
    <li
      role="treeitem"
      aria-selected={selected}
      className={cn(
        "group flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-muted/50",
        selected && "bg-primary/10 text-primary",
      )}
      onClick={onSelect}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-mono">{name}</span>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${name}`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </li>
  );
}
