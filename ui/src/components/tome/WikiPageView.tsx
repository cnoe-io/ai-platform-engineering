"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, History, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CrepeEditor,
  type CrepeEditorHandle,
  type GlossaryPreview,
} from "@/components/tome/CrepeEditor";
import { GlossaryFields } from "@/components/tome/GlossaryFields";
import { KindBadge } from "@/components/tome/KindBadge";
import {
  FM_TERM,
  FM_TITLE,
  isGlossaryTerm,
  parseFrontmatter,
  serializeFrontmatter,
  SPEC_BY_PATH,
  type FrontmatterValue,
} from "@/lib/tome/schema";
import { cn } from "@/lib/utils";
import type { PageKind } from "@/types/tome";

/** User-flippable kinds (report is system-managed via path). */
const FLIPPABLE_KINDS: { key: PageKind; label: string }[] = [
  { key: "stable", label: "Stable" },
  { key: "dynamic", label: "Dynamic" },
  { key: "hidden", label: "Hidden" },
];

interface Props {
  slug: string;
  path: string;
  /** Current page markdown (frontmatter + body). */
  markdown: string;
  onWrite: (path: string, markdown: string, message: string) => Promise<void>;
  onReload: () => void | Promise<void>;
  /** When provided, renders a close (×) button — used by the artifact pane. */
  onClose?: () => void;
  /** When provided, renders a History button opening the revision diff view. */
  onOpenHistory?: () => void;
  /** When true, an ingest is rewriting the wiki — render read-only. */
  locked?: boolean;
  /** Navigate to another wiki page (internal `tome://` link click). */
  onNavigate?: (path: string) => void;
  /** Resolve a glossary term slug to its definition for the hover card. */
  glossaryPreview?: (term: string) => GlossaryPreview | null;
  /** Rename this page to a new path. When provided, the header path is editable. */
  onRename?: (oldPath: string, newPath: string) => Promise<void>;
}

/**
 * A single wiki page: header (title + kind badge + kind toggle + edit/save) and
 * the Milkdown editor. Read-only until Edit. Used both as the main wiki view
 * and as the chat artifact pane.
 *
 * When `markdown` changes from the outside (e.g. the agent edits the page) and
 * the user isn't mid-edit, the editor remounts so the change is visible live.
 */
export function WikiPageView({
  slug,
  path,
  markdown,
  onWrite,
  onReload,
  onClose,
  onOpenHistory,
  locked = false,
  onNavigate,
  glossaryPreview,
  onRename,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [pathDraft, setPathDraft] = useState(path);
  const editorRef = useRef<CrepeEditorHandle>(null);

  const { frontmatter, body, kind, title } = useMemo(() => {
    const [fm, b] = parseFrontmatter(markdown);
    const f = fm as Record<string, FrontmatterValue>;
    const k = (typeof f.kind === "string"
      ? f.kind
      : (SPEC_BY_PATH.get(path)?.kind ?? "stable")) as PageKind;
    const t =
      typeof f.title === "string"
        ? f.title
        : (SPEC_BY_PATH.get(path)?.title ?? path);
    return { frontmatter: f, body: b, kind: k, title: t };
  }, [markdown, path]);

  const isGlossary = useMemo(() => isGlossaryTerm(frontmatter), [frontmatter]);

  // Editable copy of the frontmatter for structured (glossary) entries. Kept in
  // sync with the page's frontmatter whenever we're not mid-edit (page switch /
  // external agent edit); the Edit→Save flow mutates this draft.
  const [fmDraft, setFmDraft] = useState<Record<string, FrontmatterValue>>(frontmatter);
  useEffect(() => {
    if (!isEditing) setFmDraft(frontmatter);
  }, [frontmatter, isEditing]);

  // Switching pages resets edit state.
  useEffect(() => {
    setIsEditing(false);
    setError(null);
    setRenaming(false);
  }, [path]);

  const startRename = useCallback(() => {
    setPathDraft(path);
    setRenaming(true);
  }, [path]);

  const commitRename = useCallback(async () => {
    const next = pathDraft.trim();
    setRenaming(false);
    if (!next || next === path || !onRename) return;
    try {
      await onRename(path, next);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [pathDraft, path, onRename]);

  // External change (agent edit) while not editing → remount to show it live.
  useEffect(() => {
    if (!isEditing) setEditorEpoch((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown]);

  // Ingest started mid-edit → drop to read-only (the agent now owns the page).
  useEffect(() => {
    if (locked && isEditing) {
      setIsEditing(false);
      setEditorEpoch((n) => n + 1);
    }
  }, [locked, isEditing]);

  const handleSave = useCallback(async () => {
    if (!editorRef.current) return;
    setSaving(true);
    setError(null);
    try {
      let fmToWrite = frontmatter;
      if (isGlossary) {
        fmToWrite = { ...fmDraft };
        // Keep the sidebar title in sync with the term.
        const term = String(fmToWrite[FM_TERM] ?? "").trim();
        if (term) fmToWrite[FM_TITLE] = term;
      }
      const md = serializeFrontmatter(fmToWrite, editorRef.current.getMarkdown());
      await onWrite(path, md, `edit ${path}`);
      setIsEditing(false);
      setEditorEpoch((n) => n + 1);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [frontmatter, isGlossary, fmDraft, onWrite, path]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditorEpoch((n) => n + 1);
  }, []);

  const handleChangeKind = useCallback(
    async (newKind: PageKind) => {
      if (newKind === kind) return;
      setError(null);
      try {
        const md = serializeFrontmatter({ ...frontmatter, kind: newKind }, body);
        await onWrite(path, md, `set kind=${newKind} on ${path}`);
        await onReload();
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    },
    [kind, frontmatter, body, onWrite, onReload, path],
  );

  const dynamicWarning =
    kind === "dynamic" && isEditing
      ? "Heads up: the agent rewrites this page on every reingest. Your edits go in as context for the next rewrite, but they may not survive verbatim."
      : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-5 py-3">
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} title="Close">
            <X className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-tight">{title}</h2>
          {renaming ? (
            <input
              autoFocus
              value={pathDraft}
              onChange={(e) => setPathDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenaming(false);
                }
              }}
              onBlur={() => setRenaming(false)}
              className="block w-full max-w-md rounded border border-input bg-background px-1 py-0.5 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Rename page path (Enter to save, Esc to cancel)"
            />
          ) : onRename && !locked ? (
            <button
              type="button"
              onClick={startRename}
              title="Rename page"
              className="block max-w-full truncate font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
            >
              {path}
            </button>
          ) : (
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {path}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onOpenHistory && !isEditing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onOpenHistory}
              title="Revision history & diffs"
            >
              <History className="h-4 w-4" />
              History
            </Button>
          )}
          {!locked && <KindToggle currentKind={kind} onChange={handleChangeKind} />}
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsEditing(true)}
              disabled={locked}
              title={locked ? "Ingest in progress: the wiki is read-only" : undefined}
            >
              Edit
            </Button>
          )}
        </div>
      </div>

      {locked && (
        <p className="flex items-center gap-2 border-b bg-amber-500/10 px-5 py-2 text-sm text-amber-600 dark:text-amber-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Ingest in progress: the wiki is read-only until it finishes.
        </p>
      )}

      {error && (
        <p className="border-b bg-destructive/10 px-5 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {dynamicWarning && (
        <p className="border-b border-amber-300 bg-amber-50 px-5 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
          {dynamicWarning}
        </p>
      )}

      {isGlossary && (
        <>
          <GlossaryFields
            value={isEditing ? fmDraft : frontmatter}
            editing={isEditing}
            onChange={setFmDraft}
          />
          <div className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Definition
          </div>
        </>
      )}

      <ScrollArea
        className={cn(
          "flex-1 transition-shadow",
          isEditing &&
            "ring-2 ring-inset ring-amber-400/70 dark:ring-amber-700/60",
        )}
      >
        <CrepeEditor
          key={`${slug}-${path}-${editorEpoch}`}
          ref={editorRef}
          initialMarkdown={body}
          readonly={!isEditing}
          onNavigate={onNavigate}
          glossaryPreview={glossaryPreview}
        />
      </ScrollArea>
    </div>
  );
}

/** Popover to flip the page kind among stable / dynamic / hidden. */
function KindToggle({
  currentKind,
  onChange,
}: {
  currentKind: PageKind;
  onChange: (kind: PageKind) => void;
}) {
  const [open, setOpen] = useState(false);
  if (currentKind === "report") return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="capitalize"
          title="Change page kind"
        >
          {currentKind}
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <p className="mb-2 px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          Change kind
        </p>
        <div className="grid gap-1">
          {FLIPPABLE_KINDS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                onChange(o.key);
                setOpen(false);
              }}
              className={cn(
                "flex items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                o.key === currentKind && "bg-muted",
              )}
            >
              <span className="flex items-center gap-2">
                <KindBadge kind={o.key} iconOnly />
                <span>{o.label}</span>
              </span>
              {o.key === currentKind && (
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  current
                </span>
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
