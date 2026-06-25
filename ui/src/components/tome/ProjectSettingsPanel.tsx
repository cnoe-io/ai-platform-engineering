"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SourcesEditor } from "@/components/projects/source-pickers/SourcesEditor";
import { useProjectSourceKinds } from "@/components/projects/source-pickers/useProjectSourceKinds";
import type { ProjectDocument, ProjectSources } from "@/types/projects";

/**
 * Project settings, surfaced as a Tome view (nav item under Talk) so a project
 * can be reconfigured without leaving Tome. Edits title, description, and
 * sources (repos / Confluence / Webex via `SourcesEditor`) and persists with
 * `PATCH /api/projects/<slug>`, the same contract the project detail page uses.
 * `onSaved` lets the host refresh anything derived from the project (e.g. the
 * breadcrumb title).
 */
export function ProjectSettingsPanel({
  slug,
  onSaved,
}: {
  slug: string;
  onSaved?: (project: ProjectDocument) => void;
}) {
  const router = useRouter();
  const { kinds: sourceKinds } = useProjectSourceKinds();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sources, setSources] = useState<ProjectSources>({
    repos: [],
    confluence_url: "",
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/projects/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load project");
        return body.data.project as ProjectDocument;
      })
      .then((project) => {
        if (cancelled) return;
        setTitle(project.title);
        setDescription(project.description ?? "");
        setSources({
          repos: project.sources?.repos ?? [],
          confluence_url: project.sources?.confluence_url ?? "",
          ...project.sources,
        });
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const save = useCallback(async () => {
    setSaving(true);
    setSavedAt(false);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          sources: {
            ...sources,
            repos: (sources.repos ?? []).map((r) => r.trim()).filter(Boolean),
            confluence_url: (sources.confluence_url ?? "").trim(),
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
      const project = body.data.project as ProjectDocument;
      setTitle(project.title);
      setDescription(project.description ?? "");
      setSavedAt(true);
      onSaved?.(project);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [slug, title, description, sources, onSaved]);

  const deleteProject = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Delete failed (${res.status})`);
      router.push("/projects");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }, [slug, router]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading settings…
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <div>
          <h1 className="text-lg font-semibold">Project settings</h1>
          <p className="text-sm text-muted-foreground">
            Reconfigure this project. Changes apply to future ingests.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        {sourceKinds.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-muted-foreground">Sources</label>
              <Link
                href="/credentials"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Manage connections
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            <SourcesEditor kinds={sourceKinds} value={sources} onChange={setSources} />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-3 border-t pt-4">
          <Button onClick={() => void save()} disabled={saving || !title.trim()}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {savedAt && !saving && (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-emerald-500" />
              Saved
            </span>
          )}
        </div>

        {/* Danger zone */}
        <div className="rounded-lg border border-destructive/40 p-4 space-y-3">
          <div className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            <span className="text-sm font-semibold">Danger zone</span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Delete this project</p>
              <p className="text-xs text-muted-foreground">
                Permanently removes the wiki, ingest history, and all sources. This cannot be undone.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Type <span className="font-mono font-medium text-foreground">{slug}</span> to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={slug}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-destructive/40"
            />
            {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteConfirm !== slug || deleting}
              onClick={() => void deleteProject()}
            >
              {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {deleting ? "Deleting…" : "Delete project"}
            </Button>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
