"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Plus, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Gists: quick, non-committal chunks of context (a prompt, an agent memory, a
 * snippet) saved without becoming part of the curated wiki, not ingested, not
 * synthesized, not loaded into agent context by default. Every gist is posted
 * to the Feed automatically at creation (also reachable via the
 * tome_list_gists/tome_get_gist MCP tools). Tags are freeform labels for
 * lightweight filtering, no folder hierarchy.
 */

interface Gist {
  id: string;
  title: string;
  body: string;
  author: string;
  created_at: string;
  tags?: string[];
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export function GistsPanel({
  slug,
  onOpenGist,
}: {
  slug: string;
  onOpenGist: (id: string) => void;
}) {
  const [gists, setGists] = useState<Gist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tome/projects/${slug}/gists`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || `Failed to load gists (${res.status})`);
      setGists(body?.data?.gists ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGists([]);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(
    async (gist: Gist) => {
      if (!window.confirm(`Delete gist "${gist.title}"?`)) return;
      try {
        const res = await fetch(`/api/tome/projects/${slug}/gists/${gist.id}`, { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message || `Delete failed (${res.status})`);
        }
        setGists((prev) => (prev ?? []).filter((g) => g.id !== gist.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [slug],
  );

  const allTags = useMemo(() => {
    const seen = new Set<string>();
    for (const g of gists ?? []) for (const t of g.tags ?? []) seen.add(t);
    return [...seen].sort();
  }, [gists]);

  const visible = useMemo(() => {
    if (!activeTag) return gists ?? [];
    return (gists ?? []).filter((g) => g.tags?.includes(activeTag));
  }, [gists, activeTag]);

  return (
    <div className="flex h-full flex-col">
      {error && (
        <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="flex-1 overflow-auto">
        {gists === null ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Loading gists…</p>
        ) : gists.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-base font-semibold">No gists yet</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              Save a working prompt, a deploy note, or an agent memory here, it stays out of the
              wiki until someone chooses to pull it in.
            </p>
            <NewGistDialog slug={slug} onCreated={(gist) => onOpenGist(gist.id)} />
          </div>
        ) : (
          <div className="mx-auto max-w-4xl p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              {allTags.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveTag(null)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                      !activeTag
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    All
                  </button>
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setActiveTag(tag === activeTag ? null : tag)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                        tag === activeTag
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : (
                <div />
              )}
              <NewGistDialog slug={slug} onCreated={(gist) => onOpenGist(gist.id)} />
            </div>
            <ul className="flex flex-col gap-2">
              {visible.map((gist) => (
                <li
                  key={gist.id}
                  className="group flex items-start justify-between gap-3 rounded-lg border px-4 py-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <Link
                    href={`/projects/${slug}/tome/gists/${gist.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenGist(gist.id);
                    }}
                    className="min-w-0 flex-1"
                  >
                    <div className="font-medium text-foreground group-hover:underline">
                      {gist.title}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {gist.author} · {timeLabel(gist.created_at)}
                    </div>
                    {gist.tags && gist.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {gist.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Delete gist"
                    onClick={() => void remove(gist)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function NewGistDialog({
  slug,
  onCreated,
}: {
  slug: string;
  onCreated: (gist: Gist) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setBody("");
    setTags([]);
    setTagDraft("");
    setError(null);
  };

  const commitTagDraft = () => {
    const t = tagDraft.trim();
    setTagDraft("");
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
  };

  const create = async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/gists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body, tags }),
      });
      const resBody = await res.json();
      if (!res.ok) throw new Error(resBody?.error?.message || `Failed to create gist (${res.status})`);
      onCreated(resBody.data.gist);
      setOpen(false);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New gist
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New gist</DialogTitle>
          <DialogDescription>
            A quick, non-committal chunk of context. It won&apos;t be ingested into the wiki or
            loaded into agent context, and it&apos;s posted to the Feed as soon as you create it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <Textarea
            placeholder="Markdown body…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="font-mono text-sm"
          />
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((tag) => (
                <Badge key={tag} variant="outline" className="gap-1 pr-1 text-xs">
                  {tag}
                  <button
                    type="button"
                    onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                    className="rounded-full hover:bg-muted"
                    aria-label={`Remove tag ${tag}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Input
                placeholder="Add tag, press Enter"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    commitTagDraft();
                  }
                }}
                onBlur={commitTagDraft}
                className="h-7 w-36 border-none px-1 shadow-none focus-visible:ring-0"
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={saving || !title.trim() || !body.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
