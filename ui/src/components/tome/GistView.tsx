"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownRenderer } from "@/components/shared/timeline";

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

/** A gist read full-screen, same treatment as a wiki page rather than an
 * inline accordion snippet. */
export function GistView({
  slug,
  id,
  onBack,
}: {
  slug: string;
  id: string;
  onBack: () => void;
}) {
  const [gist, setGist] = useState<Gist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setGist(null);
    setError(null);
    fetch(`/api/tome/projects/${slug}/gists/${id}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error?.message || `Failed to load gist (${r.status})`);
        return body.data.gist as Gist;
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
        <div className="ml-auto">
          {gist && (
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
          )}
        </div>
      </div>

      {error && (
        <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
      )}

      <ScrollArea className="flex-1">
        {!gist ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Loading gist…</p>
        ) : (
          <div className="mx-auto max-w-3xl px-8 py-8">
            <h1 className="text-2xl font-semibold leading-tight">{gist.title}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {gist.author} · {timeLabel(gist.created_at)}
            </p>
            {gist.tags && gist.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {gist.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            <div className="mt-6 text-sm">
              <MarkdownRenderer content={gist.body} variant="final" />
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
