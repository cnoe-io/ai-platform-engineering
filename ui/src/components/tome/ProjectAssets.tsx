"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SourcesEditor } from "@/components/projects/source-pickers/SourcesEditor";
import { useProjectSourceKinds } from "@/components/projects/source-pickers/useProjectSourceKinds";
import type { ProjectSources } from "@/types/projects";

/**
 * The sources attached to a project — the GitHub repos / Confluence space / etc.
 * the agent reads (and that scope its read-only MCP allowlist). Which connectors
 * appear is driven by the onboarding YAML (`useProjectSourceKinds`), and the
 * picker UX is the shared `SourcesEditor` used in project creation too. Editing
 * here PATCHes the CAIPE project's `sources`, so the next ingest/chat picks them
 * up.
 */

const EMPTY: ProjectSources = { repos: [], confluence_url: "", webex_rooms: [] };

export function ProjectAssets({
  slug,
  canEdit,
}: {
  slug: string;
  canEdit: boolean;
}) {
  const { kinds, loading: kindsLoading } = useProjectSourceKinds();
  const [sources, setSources] = useState<ProjectSources | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProjectSources>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${slug}`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const json = await res.json();
      const s = json?.data?.project?.sources ?? {};
      setSources({
        repos: Array.isArray(s.repos) ? s.repos : [],
        confluence_url: typeof s.confluence_url === "string" ? s.confluence_url : "",
        webex_rooms: Array.isArray(s.webex_rooms) ? s.webex_rooms : [],
      });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = () => {
    if (!sources) return;
    setDraft(sources);
    setError(null);
    setEditing(true);
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const repos = (draft.repos ?? []).map((r) => r.trim()).filter(Boolean);
      const res = await fetch(`/api/projects/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: {
            repos,
            confluence_url: (draft.confluence_url ?? "").trim(),
            webex_rooms: draft.webex_rooms ?? [],
          },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `save failed (${res.status})`);
      }
      setEditing(false);
      await load();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [slug, draft, load]);

  const hasSources = kinds.length > 0;

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Project sources</h3>
        {canEdit && hasSources && !editing && sources !== null && (
          <Button variant="ghost" size="sm" onClick={startEdit} title="Edit sources">
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </div>

      {sources === null || kindsLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : editing ? (
        <div className="space-y-4">
          <SourcesEditor kinds={kinds} value={draft} onChange={setDraft} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <SourcesEditor kinds={kinds} value={sources} onChange={() => {}} readOnly />
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
