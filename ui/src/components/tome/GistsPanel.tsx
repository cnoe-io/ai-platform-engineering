"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Plus, Send, Trash2 } from "lucide-react";

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
import { MarkdownRenderer } from "@/components/shared/timeline";

/**
 * Gists: quick, non-committal chunks of context (a prompt, an agent memory, a
 * snippet) saved without becoming part of the curated wiki — not ingested, not
 * synthesized, not loaded into agent context by default. Share one into the
 * Feed when a teammate should see it; otherwise it just sits here, pullable
 * on demand (also reachable via the tome_list_gists/tome_get_gist MCP tools).
 */

interface Gist {
  id: string;
  title: string;
  body: string;
  author: string;
  created_at: string;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export function GistsPanel({ slug }: { slug: string }) {
  const [gists, setGists] = useState<Gist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [sharedIds, setSharedIds] = useState<Set<string>>(new Set());

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

  const share = useCallback(
    async (id: string) => {
      setSharing(id);
      try {
        const res = await fetch(`/api/tome/projects/${slug}/gists/${id}/share`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message || `Share failed (${res.status})`);
        }
        setSharedIds((prev) => new Set(prev).add(id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSharing(null);
      }
    },
    [slug],
  );

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold">Gists</h2>
          <p className="text-xs text-muted-foreground">
            Quick, non-committal context — not part of the wiki, not loaded into agent context
            unless someone pulls it in.
          </p>
        </div>
        <NewGistDialog
          slug={slug}
          onCreated={(gist) => setGists((prev) => [gist, ...(prev ?? [])])}
        />
      </div>

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
              Save a working prompt, a deploy note, or an agent memory here — it stays out of the
              wiki until someone chooses to pull it in.
            </p>
          </div>
        ) : (
          <ul className="mx-auto flex max-w-4xl flex-col gap-3 p-4">
            {gists.map((gist) => {
              const isOpen = expanded === gist.id;
              return (
                <li key={gist.id} className="rounded-lg border">
                  {/* A clickable row, not a <button> — it contains Button elements
                      (Share/Delete), and nesting <button> inside <button> is invalid
                      HTML that the browser auto-corrects, breaking hydration. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpanded(isOpen ? null : gist.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpanded(isOpen ? null : gist.id);
                      }
                    }}
                    className="flex w-full cursor-pointer items-start justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{gist.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {gist.author} · {timeLabel(gist.created_at)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto gap-1.5 px-2 py-1 text-xs"
                        disabled={sharing === gist.id}
                        onClick={() => void share(gist.id)}
                      >
                        {sharing === gist.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        {sharedIds.has(gist.id) ? "Shared" : "Share to Feed"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label="Delete gist"
                        onClick={() => void remove(gist)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="border-t px-4 py-3 text-sm">
                      <MarkdownRenderer content={gist.body} variant="final" />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setBody("");
    setError(null);
  };

  const create = async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/gists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body }),
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
            loaded into agent context — share it to the Feed when someone should see it.
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
