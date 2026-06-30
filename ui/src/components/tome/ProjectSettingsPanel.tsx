"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { LabelComboBox } from "@/components/projects/LabelComboBox";
import { SourcesEditor } from "@/components/projects/source-pickers/SourcesEditor";
import { useProjectSourceKinds } from "@/components/projects/source-pickers/useProjectSourceKinds";
import { BhagProjectsPanel } from "@/components/tome/BhagProjectsPanel";
import type { ProjectDocument, ProjectSources } from "@/types/projects";

/**
 * Project settings, surfaced as a Tome view (nav item under Talk) so a project
 * can be reconfigured without leaving Tome. Edits title, description,
 * organization (team / BHAG / swim lane), and sources, persisting with
 * `PATCH /api/projects/<slug>`. `onSaved` lets the host refresh anything
 * derived from the project (e.g. the breadcrumb title).
 *
 * Layout is grouped cards with a sticky save bar so the (now longer) form stays
 * navigable and the Sources card reserves its space up front — it never pops in
 * and shoves the rest of the form down once connectors load.
 */
export function ProjectSettingsPanel({
  slug,
  onSaved,
}: {
  slug: string;
  onSaved?: (project: ProjectDocument) => void;
}) {
  const router = useRouter();
  const { kinds: sourceKinds, loading: sourceKindsLoading } = useProjectSourceKinds();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [dangerOpen, setDangerOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // BHAG vs regular project: a BHAG shows its child projects in place of Sources.
  const [isBhag, setIsBhag] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [sources, setSources] = useState<ProjectSources>({
    repos: [],
    confluence_url: "",
  });

  // Organization
  const [teams, setTeams] = useState<TeamPickerOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamSlug, setTeamSlug] = useState("");
  const [initialTeamSlug, setInitialTeamSlug] = useState("");
  const [initiativesRaw, setInitiativesRaw] = useState("");
  const [swimlanesRaw, setSwimlanesRaw] = useState("");
  const [labelFacets, setLabelFacets] = useState<{ initiatives: string[]; swimlanes: string[] }>({
    initiatives: [],
    swimlanes: [],
  });

  // Load the project.
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
        setIsBhag(project.type === "bhag");
        setProjectName(project.name ?? project.title ?? "");
        setSources({
          repos: project.sources?.repos ?? [],
          confluence_url: project.sources?.confluence_url ?? "",
          ...project.sources,
        });
        setTeamSlug(project.team_slug ?? "");
        setInitialTeamSlug(project.team_slug ?? "");
        setInitiativesRaw((project.labels?.initiatives ?? []).join(", "));
        setSwimlanesRaw((project.labels?.swimlanes ?? []).join(", "));
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Load label facets (datalist suggestions) + assignable teams.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/projects/facets")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        const f = body?.data?.facets ?? body?.data ?? body;
        const vals = (arr: unknown): string[] =>
          Array.isArray(arr)
            ? arr
                .map((x) => (typeof x === "string" ? x : (x?.value ?? x?.label)))
                .filter((v): v is string => typeof v === "string" && v.length > 0)
            : [];
        if (f) {
          setLabelFacets({ initiatives: vals(f.initiatives), swimlanes: vals(f.swimlanes) });
        }
      })
      .catch(() => undefined);

    fetch("/api/dynamic-agents/teams")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const list = (data.data ?? data.teams ?? []) as Array<{
          _id: string;
          name: string;
          slug?: string;
        }>;
        setTeams(
          list.map((t) => ({ slug: t.slug ?? t._id, name: t.name, id: t._id, _id: t._id })),
        );
      })
      .catch(() => !cancelled && setTeams([]))
      .finally(() => !cancelled && setTeamsLoading(false));

    return () => {
      cancelled = true;
    };
  }, []);

  const teamChanged = teamSlug !== initialTeamSlug;
  const selectedTeamId = useMemo(
    () => teams.find((t) => t.slug === teamSlug)?._id,
    [teams, teamSlug],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setSavedAt(false);
    setError(null);
    const toList = (raw: string) =>
      raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    try {
      const payload: Record<string, unknown> = {
        title,
        description,
        initiatives: toList(initiativesRaw),
        swimlanes: toList(swimlanesRaw),
        sources: {
          ...sources,
          repos: (sources.repos ?? []).map((r) => r.trim()).filter(Boolean),
          confluence_url: (sources.confluence_url ?? "").trim(),
        },
      };
      // Only send team_id when the team actually changed — avoids the
      // reassignment permission/sync path on an ordinary save.
      if (teamChanged && selectedTeamId) payload.team_id = selectedTeamId;

      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
      const project = body.data.project as ProjectDocument;
      setTitle(project.title);
      setDescription(project.description ?? "");
      setTeamSlug(project.team_slug ?? "");
      setInitialTeamSlug(project.team_slug ?? "");
      setInitiativesRaw((project.labels?.initiatives ?? []).join(", "));
      setSwimlanesRaw((project.labels?.swimlanes ?? []).join(", "));
      setSavedAt(true);
      onSaved?.(project);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [
    slug,
    title,
    description,
    initiativesRaw,
    swimlanesRaw,
    sources,
    teamChanged,
    selectedTeamId,
    onSaved,
  ]);

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
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl space-y-5 p-6">
          <div>
            <h1 className="text-lg font-semibold">Project settings</h1>
            <p className="text-sm text-muted-foreground">
              Reconfigure this project. Changes apply to future ingests.
            </p>
          </div>

          {/* General */}
          <Section title="General">
            <Field label="Title">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </Field>
            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </Field>
          </Section>

          {/* Organization */}
          <Section title="Organization">
            <Field label="Team">
              <TeamPicker
                options={teams}
                value={teamSlug}
                onChange={setTeamSlug}
                placeholder={teamsLoading ? "Loading teams…" : "Select owning team"}
                disabled={teamsLoading}
                ariaLabel="Team"
              />
              {teamChanged && (
                <p className="mt-1 text-xs text-amber-500">
                  Reassigning the team changes who can see and manage this project.
                </p>
              )}
            </Field>
            <Field label="BHAG / Initiatives" hint="Pick existing or type a new one (comma-separated).">
              <LabelComboBox
                ariaLabel="BHAG / Initiatives"
                value={initiativesRaw}
                onChange={setInitiativesRaw}
                options={labelFacets.initiatives.map((v) => ({ value: v, label: v }))}
                placeholder="Agentic-2026, Platform Modernization"
                multi
              />
            </Field>
            <Field label="Swim Lanes" hint="Pick existing or type a new one (comma-separated).">
              <LabelComboBox
                ariaLabel="Swim Lanes"
                value={swimlanesRaw}
                onChange={setSwimlanesRaw}
                options={labelFacets.swimlanes.map((v) => ({ value: v, label: v }))}
                placeholder="Now, Next, Later"
                multi
              />
            </Field>
          </Section>

          {/* A BHAG has no connectors — its "sources" are the projects tagged to
              it, which the agent reads to synthesize the BHAG wiki. Regular
              projects show the Sources editor (reserves space so it never pops
              in on load). */}
          {isBhag ? (
            <Section title="Projects">
              <BhagProjectsPanel bhagName={projectName} />
            </Section>
          ) : (
            <Section
              title="Sources"
              action={
                <Link
                  href="/credentials"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Manage connections
                  <ExternalLink className="h-3 w-3" />
                </Link>
              }
            >
              {sourceKindsLoading ? (
                <div className="space-y-2" aria-hidden>
                  <div className="h-9 animate-pulse rounded-lg bg-muted/50" />
                  <div className="h-9 animate-pulse rounded-lg bg-muted/50" />
                </div>
              ) : sourceKinds.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No source connectors are configured for this deployment.
                </p>
              ) : (
                <SourcesEditor kinds={sourceKinds} value={sources} onChange={setSources} />
              )}
            </Section>
          )}

          {/* Danger zone — collapsed by default. */}
          <div className="rounded-lg border border-destructive/40">
            <button
              type="button"
              onClick={() => setDangerOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-destructive"
            >
              {dangerOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
              <TriangleAlert className="h-4 w-4 shrink-0" />
              <span className="text-sm font-semibold">Danger zone</span>
            </button>
            {dangerOpen && (
              <div className="space-y-3 border-t border-destructive/40 p-4">
                <div>
                  <p className="text-sm font-medium">Delete this project</p>
                  <p className="text-xs text-muted-foreground">
                    Permanently removes the wiki, ingest history, and all sources. This cannot be
                    undone.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Type <span className="font-mono font-medium text-foreground">{slug}</span> to
                    confirm.
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
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Sticky save bar */}
      <div className="flex items-center gap-3 border-t bg-background px-6 py-3">
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
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}

/** A titled card section with a proper header (not label-sized). */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
