"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Code, Eye, Link2, Loader2, Pencil, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownRenderer } from "@/components/shared/timeline";
import { CrepeEditor, type CrepeEditorHandle } from "@/components/tome/CrepeEditor";
import type { GistRecord } from "@/components/tome/GistEditorDialog";
import { TomeLoading } from "@/components/tome/TomeLoading";
import { cn } from "@/lib/utils";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/** A gist read full-screen, same treatment as a wiki page rather than an
 * inline accordion snippet. */
export function GistView({
  slug,
  id,
  canEdit,
  onBack,
}: {
  slug: string;
  id: string;
  canEdit: boolean;
  onBack: () => void;
}) {
  const [gist, setGist] = useState<GistRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [rawDraft, setRawDraft] = useState("");
  const [previewBody, setPreviewBody] = useState("");
  const [richInitialBody, setRichInitialBody] = useState("");
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<CrepeEditorHandle>(null);

  useEffect(() => {
    let cancelled = false;
    setGist(null);
    setError(null);
    setEditing(false);
    setRawMode(false);
    setPreviewMode(false);
    fetch(`/api/tome/projects/${slug}/gists/${id}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error?.message || `Failed to load gist (${r.status})`);
        return body.data.gist as GistRecord;
      })
      .then((g) => {
        if (!cancelled) setGist(g);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, id]);

  const beginEditing = useCallback(() => {
    if (!gist) return;
    setTitle(gist.title);
    setRichInitialBody(gist.body);
    setRawDraft(gist.body);
    setTags(gist.tags ?? []);
    setTagDraft("");
    setError(null);
    setRawMode(false);
    setPreviewMode(false);
    setEditorEpoch((current) => current + 1);
    setEditing(true);
  }, [gist]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setRawMode(false);
    setPreviewMode(false);
    setTagDraft("");
    setError(null);
    setEditorEpoch((current) => current + 1);
  }, []);

  const toggleRawMode = useCallback(() => {
    if (!rawMode) {
      setRawDraft(editorRef.current?.getMarkdown() ?? richInitialBody);
    } else {
      setRichInitialBody(rawDraft);
      setEditorEpoch((current) => current + 1);
    }
    setRawMode((current) => !current);
  }, [rawMode, rawDraft, richInitialBody]);

  const togglePreviewMode = useCallback(() => {
    if (!previewMode) {
      setPreviewBody(rawMode ? rawDraft : (editorRef.current?.getMarkdown() ?? richInitialBody));
      setPreviewMode(true);
      return;
    }
    if (!rawMode) {
      setRichInitialBody(previewBody);
      setEditorEpoch((current) => current + 1);
    }
    setPreviewMode(false);
  }, [previewMode, previewBody, rawMode, rawDraft, richInitialBody]);

  const commitTagDraft = useCallback(() => {
    const tag = tagDraft.trim();
    setTagDraft("");
    if (tag && !tags.includes(tag)) setTags((current) => [...current, tag]);
  }, [tagDraft, tags]);

  const save = useCallback(async () => {
    if (!gist || !title.trim() || (!previewMode && !rawMode && !editorRef.current)) return;
    const body = previewMode
      ? previewBody
      : rawMode
        ? rawDraft
        : editorRef.current!.getMarkdown();
    if (!body.trim()) return;
    const pendingTag = tagDraft.trim();
    const nextTags = pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/tome/projects/${slug}/gists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body, tags: nextTags }),
      });
      const responseBody = await response.json();
      if (!response.ok) {
        throw new Error(responseBody?.error?.message || `Failed to update gist (${response.status})`);
      }
      setGist(responseBody.data.gist as GistRecord);
      setEditing(false);
      setRawMode(false);
      setPreviewMode(false);
      setTagDraft("");
      setEditorEpoch((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }, [gist, title, rawMode, rawDraft, previewMode, previewBody, tagDraft, tags, slug, id]);

  const remove = useCallback(async () => {
    if (!gist) return;
    if (!window.confirm(`Delete gist "${gist.title}"?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/gists/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Delete failed (${res.status})`);
      }
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }, [slug, id, gist, onBack]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Button variant="ghost" size="sm" className="h-auto gap-1.5 px-2 py-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Gists
        </Button>
        <div className="ml-auto flex items-center gap-1">
          {gist && !editing && (
            <>
              <CopyButton
                value={() => `${window.location.origin}/projects/${slug}/tome/gists/${id}`}
                label="Share"
                copiedLabel="Link copied"
                icon={Link2}
                size="sm"
                className="h-auto px-2 py-1 text-muted-foreground"
              >
                Share
              </CopyButton>
              <CopyButton
                value={() => gist.body}
                label="Copy page"
                copiedLabel="Copied"
                size="sm"
                className="h-auto px-2 py-1 text-muted-foreground"
              >
                Copy page
              </CopyButton>
            </>
          )}
          {gist && canEdit && (
            <>
              {editing ? (
                <div className="flex items-center divide-x divide-border rounded-md border border-border">
                  <button
                    type="button"
                    onClick={toggleRawMode}
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
                  <button
                    type="button"
                    onClick={togglePreviewMode}
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
                    onClick={cancelEditing}
                    disabled={saving}
                    className="px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving || !title.trim()}
                    className="flex items-center gap-1 rounded-r-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto gap-1.5 px-2 py-1 text-muted-foreground"
                    onClick={beginEditing}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto gap-1.5 px-2 py-1 text-muted-foreground hover:text-destructive"
                    disabled={deleting}
                    onClick={() => void remove()}
                  >
                    {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Delete
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
      )}

      <ScrollArea
        className={cn(
          "flex-1 transition-shadow",
          editing && "ring-2 ring-inset ring-amber-400/70 dark:ring-amber-700/60",
        )}
      >
        {!gist ? (
          <TomeLoading />
        ) : (
          <div className="mx-auto max-w-3xl px-8 py-8">
            {editing && !previewMode ? (
              <Input
                aria-label="Gist title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="h-auto border-0 px-0 py-0 text-2xl font-semibold leading-tight shadow-none focus-visible:ring-0"
                autoFocus
              />
            ) : (
              <h1 className="text-2xl font-semibold leading-tight">
                {editing ? title.trim() || "Untitled gist" : gist.title}
              </h1>
            )}
            <p className="mt-1.5 text-sm text-muted-foreground">
              {gist.author} · {timeLabel(gist.created_at)}
              {gist.updated_at && (
                <>
                  {" "}· edited {timeLabel(gist.updated_at)}
                  {gist.updated_by ? ` by ${gist.updated_by}` : ""}
                </>
              )}
            </p>
            {editing && !previewMode ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="gap-1 pr-1 text-xs">
                    {tag}
                    <button
                      type="button"
                      onClick={() => setTags((current) => current.filter((value) => value !== tag))}
                      className="rounded-full hover:bg-muted"
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <Input
                  aria-label="Add tag"
                  placeholder="Add tag, press Enter"
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      commitTagDraft();
                    }
                  }}
                  onBlur={commitTagDraft}
                  className="h-7 w-36 border-none px-1 shadow-none focus-visible:ring-0"
                />
              </div>
            ) : editing && tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : gist.tags && gist.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {gist.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
            <div className="mt-6 text-sm">
              {editing ? (
                previewMode ? (
                  <MarkdownRenderer
                    content={previewBody}
                    variant="final"
                    enableExternalEmbeds
                  />
                ) : rawMode ? (
                  <div className="milkdown-host min-h-[28rem]">
                    <textarea
                      aria-label="Raw markdown editor"
                      className="raw-markdown-editor min-h-[28rem]"
                      value={rawDraft}
                      onChange={(event) => setRawDraft(event.target.value)}
                      spellCheck={false}
                    />
                  </div>
                ) : (
                  <CrepeEditor
                    key={`${slug}-${id}-${editorEpoch}`}
                    ref={editorRef}
                    initialMarkdown={richInitialBody}
                  />
                )
              ) : (
                <MarkdownRenderer
                  content={gist.body}
                  variant="final"
                  enableExternalEmbeds
                />
              )}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
