"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CrepeEditor, type CrepeEditorHandle } from "@/components/tome/CrepeEditor";
import { KindBadge } from "@/components/tome/KindBadge";
import {
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
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
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

  // Switching pages resets edit state.
  useEffect(() => {
    setIsEditing(false);
    setError(null);
  }, [path]);

  // External change (agent edit) while not editing → remount to show it live.
  useEffect(() => {
    if (!isEditing) setEditorEpoch((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown]);

  const handleSave = useCallback(async () => {
    if (!editorRef.current) return;
    setSaving(true);
    setError(null);
    try {
      const md = serializeFrontmatter(frontmatter, editorRef.current.getMarkdown());
      await onWrite(path, md, `edit ${path}`);
      setIsEditing(false);
      setEditorEpoch((n) => n + 1);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [frontmatter, onWrite, path]);

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
        <h2 className="truncate text-base font-semibold">{title}</h2>
        <KindBadge kind={kind} />
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {path}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <KindToggle currentKind={kind} onChange={handleChangeKind} />
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
            >
              Edit
            </Button>
          )}
        </div>
      </div>

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
