"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ChevronDown, Code, Eye, Loader2, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CrepeEditor, type CrepeEditorHandle } from "@/components/tome/CrepeEditor";
import type { GlossaryResolver } from "@/lib/tome/tome-links";
import { GlossaryFields } from "@/components/tome/GlossaryFields";
import { EdgeFields } from "@/components/tome/EdgeFields";
import { TrackedEntityFields } from "@/components/tome/TrackedEntityFields";
import { KindBadge } from "@/components/tome/KindBadge";
import { ViewOnlyTooltip } from "@/components/tome/ViewOnlyTooltip";
import { WikiExportMenu } from "@/components/tome/WikiExportMenu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  FM_RELATION,
  FM_SOURCE,
  FM_SOURCE_PATH,
  FM_SOURCE_REPO,
  FM_TARGET,
  FM_TEMPLATE_PATH,
  FM_TEMPLATE_SCOPE,
  FM_TEMPLATE_VERSION,
  FM_TERM,
  FM_TITLE,
  isEdge,
  isGlossaryTerm,
  isMirrorPage,
  isTrackedEntity,
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
  /** When true, `locked` is because a draft is awaiting review (not an active
   * ingest) — same read-only effect, different banner copy. */
  awaitingReview?: boolean;
  /** Navigate to another wiki page (internal `tome://` link click). */
  onNavigate?: (path: string) => void;
  /** Resolve a glossary term slug to its definition for the hover card. */
  glossaryPreview?: GlossaryResolver;
  /** Rename this page to a new path. When provided, the header path is editable. */
  onRename?: (oldPath: string, newPath: string) => Promise<void>;
  /** OpenFGA steward/admin decision for all write affordances. */
  canEdit?: boolean;
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
  awaitingReview = false,
  onNavigate,
  glossaryPreview,
  onRename,
  canEdit = true,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [wideReading, setWideReading] = useState(false);
  const [rawDraft, setRawDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  // The markdown body fed into CrepeEditor on mount; updated when switching
  // back from raw mode so unsaved raw edits survive the remount.
  const [richInitialBody, setRichInitialBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [pathDraft, setPathDraft] = useState(path);
  const editorRef = useRef<CrepeEditorHandle>(null);

  // Last revision — fetched once per page, used for the "Updated X ago by Y" line.
  const [lastRevision, setLastRevision] = useState<{
    author: string;
    created_at: string;
  } | null>(null);
  useEffect(() => {
    setLastRevision(null);
    let cancelled = false;
    fetch(`/api/tome/projects/${slug}/history/${path}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setLastRevision(j?.data?.revisions?.[0] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [slug, path]);

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
  const isEdgeEntry = useMemo(() => isEdge(frontmatter), [frontmatter]);
  const isTrackedEntry = useMemo(() => isTrackedEntity(frontmatter), [frontmatter]);
  const isMirror = useMemo(() => isMirrorPage(frontmatter), [frontmatter]);

  // Template binding (#488/#508): passive, zero-extra-fetch badge read
  // straight off this page's own frontmatter (code-stamped by the ingest
  // persist hook, never agent-authored). Only says whether/at-what-version
  // this page is bound to a template; whether that version is stale and
  // whether its content has drifted is the "Check for template drift"
  // report (Templates tab), not repeated on every page load.
  const templateBinding = useMemo(() => {
    const scope = frontmatter[FM_TEMPLATE_SCOPE];
    if (!scope || scope === "null") return null;
    const templatePath = frontmatter[FM_TEMPLATE_PATH];
    const version = frontmatter[FM_TEMPLATE_VERSION];
    return {
      scope: String(scope),
      templatePath: templatePath ? String(templatePath) : null,
      version: typeof version === "number" ? version : null,
    };
  }, [frontmatter]);

  // Editable copy of the frontmatter for structured (glossary/edge) entries.
  // Kept in sync with the page's frontmatter whenever we're not mid-edit (page
  // switch / external agent edit); the Edit→Save flow mutates this draft.
  const [fmDraft, setFmDraft] = useState<Record<string, FrontmatterValue>>(frontmatter);
  useEffect(() => {
    if (!isEditing) setFmDraft(frontmatter);
  }, [frontmatter, isEditing]);

  // Switching pages resets edit state.
  useEffect(() => {
    setIsEditing(false);
    setRawMode(false);
    setPreviewMode(false);
    setError(null);
    setRenaming(false);
  }, [path]);

  // Track content changes that landed while this page was open (an out-of-band
  // edit picked up by the polling in TomeWiki) — surfaced as a badge on the
  // History button. Reset on page switch or once the user opens History
  // (they've now seen it). `openedMarkdownRef` anchors "since open" to the
  // first markdown seen for this path, not every render.
  const openedMarkdownRef = useRef(markdown);
  const [changesSinceOpen, setChangesSinceOpen] = useState(0);
  useEffect(() => {
    // Path change: re-anchor to whatever markdown this render has. Reacting
    // to `markdown` here too would re-arm on every content change instead
    // of only on a page switch, so it's deliberately left out of deps.
    openedMarkdownRef.current = markdown;
    setChangesSinceOpen(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => {
    if (markdown !== openedMarkdownRef.current) {
      openedMarkdownRef.current = markdown;
      setChangesSinceOpen((n) => n + 1);
    }
  }, [markdown]);

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

  // Seed richInitialBody when an edit session starts so it's available for
  // raw→rich mode transitions without depending on the editorRef being ready.
  useEffect(() => {
    if (isEditing) setRichInitialBody(body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  // External change (agent edit) while not editing → remount to show it live.
  useEffect(() => {
    if (!isEditing) setEditorEpoch((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown]);

  // Ingest started mid-edit → drop to read-only (the agent now owns the page).
  useEffect(() => {
    if (locked && isEditing) {
      setIsEditing(false);
      setRawMode(false);
      setPreviewMode(false);
      setEditorEpoch((n) => n + 1);
    }
  }, [locked, isEditing]);

  const handleSave = useCallback(async () => {
    if (!rawMode && !editorRef.current) return;
    setSaving(true);
    setError(null);
    try {
      let fmToWrite = frontmatter;
      if (isGlossary) {
        fmToWrite = { ...fmDraft };
        const term = String(fmToWrite[FM_TERM] ?? "").trim();
        if (term) fmToWrite[FM_TITLE] = term;
      } else if (isEdgeEntry) {
        fmToWrite = { ...fmDraft };
        const relation = String(fmToWrite[FM_RELATION] ?? "").trim();
        const source = String(fmToWrite[FM_SOURCE] ?? "").trim();
        const target = String(fmToWrite[FM_TARGET] ?? "").trim();
        if (relation && source && target) {
          fmToWrite[FM_TITLE] = `${source} ${relation} ${target}`;
        }
      } else if (isTrackedEntry) {
        fmToWrite = { ...fmDraft };
      }
      const bodyContent = rawMode ? rawDraft : editorRef.current!.getMarkdown();
      const md = serializeFrontmatter(fmToWrite, bodyContent);
      await onWrite(path, md, `edit ${path}`);
      setIsEditing(false);
      setRawMode(false);
      setPreviewMode(false);
      setEditorEpoch((n) => n + 1);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [rawMode, rawDraft, frontmatter, isGlossary, isEdgeEntry, isTrackedEntry, fmDraft, onWrite, path]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setRawMode(false);
    setPreviewMode(false);
    setEditorEpoch((n) => n + 1);
  }, []);

  const handleToggleRawMode = useCallback(() => {
    if (!rawMode) {
      // Crepe → raw: snapshot the current rich content into the textarea.
      const current = editorRef.current?.getMarkdown() ?? richInitialBody;
      setRawDraft(current);
    } else {
      // Raw → Crepe: feed the textarea content into a fresh editor instance.
      setRichInitialBody(rawDraft);
      setEditorEpoch((n) => n + 1);
    }
    setRawMode((v) => !v);
  }, [rawMode, rawDraft, richInitialBody]);

  const handleTogglePreview = useCallback(() => {
    if (!previewMode && rawMode) {
      // Render the raw draft through Crepe without losing the textarea state.
      setRichInitialBody(rawDraft);
      setEditorEpoch((n) => n + 1);
    }
    setPreviewMode((current) => !current);
  }, [previewMode, rawMode, rawDraft]);

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
          <div className="flex min-w-0 items-center gap-1.5">
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
            ) : onRename && canEdit && !locked ? (
              <button
                type="button"
                onClick={startRename}
                title="Rename page"
                className="min-w-0 truncate font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
              >
                {path}
              </button>
            ) : (
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                {path}
              </span>
            )}
            {lastRevision && onOpenHistory && !isEditing && (
              <>
                <span className="shrink-0 text-[11px] text-muted-foreground/40">·</span>
                <button
                  type="button"
                  onClick={() => {
                    setChangesSinceOpen(0);
                    onOpenHistory();
                  }}
                  className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  title="Open revision history"
                >
                  {changesSinceOpen > 0 && (
                    <span className="mr-1 inline-block rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
                      {changesSinceOpen} new
                    </span>
                  )}
                  Updated {relativeTime(lastRevision.created_at)} by {lastRevision.author}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  "cursor-default text-[10px] font-medium normal-case",
                  templateBinding
                    ? "border-muted-foreground/30 text-muted-foreground"
                    : "border-muted-foreground/20 text-muted-foreground/60",
                )}
              >
                {templateBinding ? `template v${templateBinding.version ?? "?"}` : "not from a template"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64 whitespace-normal text-[11px]">
              {templateBinding ? (
                <>
                  Seeded from the <code>{templateBinding.scope}</code> template&apos;s{" "}
                  <code>{templateBinding.templatePath}</code> at version {templateBinding.version ?? "unknown"}.
                  Run &quot;Check for template drift&quot; (Templates tab) to see whether it&apos;s current.
                </>
              ) : (
                "This page isn't bound to a page template (a manual addition, or it hasn't been re-ingested since template binding shipped)."
              )}
            </TooltipContent>
          </Tooltip>
          {isMirror && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="cursor-default text-[10px] font-medium uppercase tracking-wide border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/30 dark:text-amber-300"
                >
                  mirror
                </Badge>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="flex w-64 flex-col gap-1 whitespace-normal text-[11px] font-normal normal-case leading-relaxed"
              >
                <span className="text-xs font-semibold">Verbatim mirror</span>
                <span className="opacity-70">
                  Copied byte-for-byte from{" "}
                  <code>{String(frontmatter[FM_SOURCE_REPO] ?? "")}</code>
                  {"'s "}
                  <code>{String(frontmatter[FM_SOURCE_PATH] ?? "")}</code>. Re-mirrored
                  every ingest: edits here don&apos;t stick unless the source file
                  changes.
                </span>
              </TooltipContent>
            </Tooltip>
          )}
          {canEdit && !locked && !isMirror && (
            <KindToggle currentKind={kind} onChange={handleChangeKind} />
          )}
          {!isEditing && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setWideReading((v) => !v)}
                    aria-pressed={wideReading}
                    className={cn(
                      "rounded-md border border-border p-1.5 transition-colors hover:bg-muted hover:text-foreground",
                      wideReading ? "bg-muted text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {wideReading ? "Narrow reading width" : "Wide reading width"}
                </TooltipContent>
              </Tooltip>
              <WikiExportMenu
                slug={slug}
                path={path}
                triggerClassName="border border-border p-1.5"
              />
            </>
          )}
          {isEditing ? (
            <div className="flex items-center divide-x divide-border rounded-md border border-border">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleToggleRawMode}
                    disabled={saving || previewMode}
                    aria-pressed={rawMode}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md",
                      rawMode
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Code className="h-3.5 w-3.5" />
                    {rawMode ? "Rich" : "Raw"}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {rawMode ? "Switch to rich editor" : "Edit raw markdown"}
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                onClick={handleTogglePreview}
                disabled={saving}
                aria-pressed={previewMode}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors",
                  previewMode
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {previewMode ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {previewMode ? "Edit" : "Preview"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground first:rounded-l-md last:rounded-r-md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-r-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          ) : (
            <ViewOnlyTooltip viewOnly={!canEdit}>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                disabled={locked || !canEdit || isMirror}
                title={
                  isMirror
                    ? "Verbatim mirror of the source repo's .tome/pages file: edit it there instead, this copy is overwritten on every ingest"
                    : canEdit && locked
                      ? awaitingReview
                        ? "A draft is awaiting review: approve or reject it before editing"
                        : "Ingest in progress: the wiki is read-only"
                      : undefined
                }
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                Edit
              </button>
            </ViewOnlyTooltip>
          )}
        </div>
      </div>

      {locked && (
        <p className="flex items-center gap-2 border-b bg-amber-500/10 px-5 py-2 text-sm text-amber-600 dark:text-amber-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {awaitingReview
            ? "A draft is awaiting review: the wiki is read-only until it's approved or rejected."
            : "Ingest in progress: the wiki is read-only until it finishes."}
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
            editing={isEditing && !previewMode}
            onChange={setFmDraft}
          />
          <div className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Definition
          </div>
        </>
      )}

      {isEdgeEntry && (
        <>
          <EdgeFields
            value={isEditing ? fmDraft : frontmatter}
            editing={isEditing && !previewMode}
            onChange={setFmDraft}
          />
          <div className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Explanation
          </div>
        </>
      )}

      {isTrackedEntry && (
        <>
          <TrackedEntityFields
            value={isEditing ? fmDraft : frontmatter}
            editing={isEditing && !previewMode}
            onChange={setFmDraft}
          />
          <div className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Context and evidence
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
        <div className={cn(!isEditing && wideReading && "wide-reading")}>
          {isEditing && rawMode && !previewMode ? (
            <div className="milkdown-host h-full">
              <textarea
                className="raw-markdown-editor"
                value={rawDraft}
                onChange={(e) => setRawDraft(e.target.value)}
                spellCheck={false}
                aria-label="Raw markdown editor"
              />
            </div>
          ) : (
            <CrepeEditor
              key={`${slug}-${path}-${editorEpoch}`}
              ref={editorRef}
              initialMarkdown={isEditing ? richInitialBody : body}
              readonly={!isEditing || previewMode}
              onNavigate={onNavigate}
              glossaryPreview={glossaryPreview}
              hideHtmlComments
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
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
        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium capitalize text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Change page kind"
        >
          {currentKind}
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
          />
        </button>
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
