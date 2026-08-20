"use client";

import { useCallback, useState } from "react";
import { Loader2, Pencil, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface GistRecord {
  id: string;
  title: string;
  body: string;
  author: string;
  created_at: string;
  updated_at?: string;
  updated_by?: string;
  tags?: string[];
}

export function GistEditorDialog({
  slug,
  gist,
  onSaved,
}: {
  slug: string;
  gist?: GistRecord;
  onSaved: (saved: GistRecord) => void;
}) {
  const editing = Boolean(gist);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setTitle(gist?.title ?? "");
    setBody(gist?.body ?? "");
    setTags(gist?.tags ?? []);
    setTagDraft("");
    setError(null);
  }, [gist]);

  const commitTagDraft = () => {
    const tag = tagDraft.trim();
    setTagDraft("");
    if (tag && !tags.includes(tag)) setTags((current) => [...current, tag]);
  };

  const save = async () => {
    if (!title.trim() || !body.trim()) return;
    const pendingTag = tagDraft.trim();
    const nextTags = pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags;
    setSaving(true);
    setError(null);
    try {
      const endpoint = editing
        ? `/api/tome/projects/${slug}/gists/${gist?.id}`
        : `/api/tome/projects/${slug}/gists`;
      const response = await fetch(endpoint, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body, tags: nextTags }),
      });
      const responseBody = await response.json();
      if (!response.ok) {
        throw new Error(
          responseBody?.error?.message ||
            `Failed to ${editing ? "update" : "create"} gist (${response.status})`,
        );
      }
      onSaved(responseBody.data.gist as GistRecord);
      setOpen(false);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        {editing ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto gap-1.5 px-2 py-1 text-muted-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        ) : (
          <Button size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New gist
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit gist" : "New gist"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update this gist without adding another entry to the project Feed."
              : "A quick, non-committal chunk of context. It won’t be ingested into the wiki or loaded into agent context, and it’s posted to the Feed as soon as you create it."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            aria-label="Gist title"
            placeholder="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
          <Textarea
            aria-label="Gist body"
            placeholder="Markdown body…"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={10}
            className="font-mono text-sm"
          />
          <div className="flex flex-wrap items-center gap-1.5">
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
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !title.trim() || !body.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
