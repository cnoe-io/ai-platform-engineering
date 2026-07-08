"use client";

// assisted-by Cursor Composer

import Link from "next/link";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Bot,
  BookOpen,
  ChevronDown,
  Copy,
  Database,
  DollarSign,
  ExternalLink,
  FolderKanban,
  LayoutGrid,
  Loader2,
  Pencil,
  Trash2,
  Video,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { SourcesEditor } from "@/components/projects/source-pickers/SourcesEditor";
import { useProjectSourceKinds } from "@/components/projects/source-pickers/useProjectSourceKinds";
import type { ProjectDocument, ProjectSources } from "@/types/projects";

export function ProjectDetailView({ slug }: { slug: string }) {
  const { kinds: sourceKinds } = useProjectSourceKinds();
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [catalogYaml, setCatalogYaml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSources, setEditSources] = useState<ProjectSources>({
    repos: [],
    confluence_url: "",
  });

  async function confirmDelete() {
    if (!project) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      window.location.href = "/projects";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  function openEdit() {
    if (!project) return;
    setEditTitle(project.title);
    setEditDescription(project.description ?? "");
    setEditSources({
      repos: project.sources?.repos ?? [],
      confluence_url: project.sources?.confluence_url ?? "",
    });
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!project) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          sources: {
            repos: (editSources.repos ?? []).map((r) => r.trim()).filter(Boolean),
            confluence_url: (editSources.confluence_url ?? "").trim(),
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      const data = await res.json();
      setProject(data.data.project as ProjectDocument);
      setEditOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.error ?? "Failed to load project");
        }
        setProject(body.data.project as ProjectDocument);
        setCatalogYaml(body.data.catalog_yaml ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [slug]);

  async function copyYaml() {
    await navigator.clipboard.writeText(catalogYaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return <p className="p-6 text-muted-foreground">Loading project…</p>;
  }

  if (error || !project) {
    return (
      <div className="p-6">
        <p className="text-red-600">{error ?? "Project not found"}</p>
        <Link href="/projects" className="mt-4 inline-block text-primary hover:underline">
          ← Back to projects
        </Link>
      </div>
    );
  }

  const integrations = Object.entries(project.integrations ?? {})
    .filter(([key, value]) => Boolean(value) && !key.endsWith("_label"))
    .map(([key, value]) => ({
      label: key.replace(/_/g, " "),
      url: value,
    }));

  // Navigable app tiles from the *_url integrations. Display name comes from a
  // `<slug>_label` integration (set by onboarding from the step's configured
  // title) when present; otherwise the key is humanized. No product- or
  // deployment-specific names are hardcoded here.
  const humanize = (slug: string): string =>
    slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  // Presentational icon by generic keyword in the integration key (purely
  // visual; no product names). Falls back to a generic app icon + a colorful
  // hashed gradient so every tile is distinct.
  const iconForSlug = (slug: string): LucideIcon => {
    const s = slug.toLowerCase();
    if (/wiki|doc|book|knowledge/.test(s)) return BookOpen;
    if (/sdlc|workflow|pipeline|ci|cd/.test(s)) return Workflow;
    if (/cost|finops|budget|spend|billing/.test(s)) return DollarSign;
    if (/mesh|agent|bot/.test(s)) return Bot;
    if (/catalog|registry|inventory/.test(s)) return Database;
    if (/meet|webex|video|call|chat/.test(s)) return Video;
    return LayoutGrid;
  };
  const APP_GRADIENTS = [
    "from-amber-500 via-orange-500 to-rose-500",
    "from-sky-500 via-blue-500 to-indigo-600",
    "from-emerald-500 via-teal-500 to-cyan-600",
    "from-fuchsia-500 via-purple-500 to-violet-600",
    "from-cyan-500 via-sky-500 to-blue-600",
    "from-orange-500 via-red-500 to-rose-600",
  ];
  const gradientFor = (slug: string): string => {
    let h = 0;
    for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return APP_GRADIENTS[h % APP_GRADIENTS.length];
  };
  const integrationsMap = project.integrations ?? {};
  const appTiles = Object.entries(integrationsMap)
    .filter(([key, value]) => key.endsWith("_url") && Boolean(value))
    .map(([key, value]) => {
      const slug = key.replace(/_url$/, "");
      const url = String(value);
      const label = integrationsMap[`${slug}_label`] || humanize(slug);
      // Optional custom image icon, config-driven like `<slug>_label`. When set
      // (a deployment overlay value), it replaces the generic keyword icon.
      const iconUrl = integrationsMap[`${slug}_icon`] || undefined;
      return {
        key,
        label,
        url,
        iconUrl,
        external: /^https?:\/\//.test(url),
        // Match the keyword against slug + display label (label comes from
        // deployment config), so a "wiki" tile gets the book icon.
        Icon: iconForSlug(`${slug} ${label}`),
        gradient: gradientFor(slug),
      };
    });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Projects
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-primary-br text-white">
            <FolderKanban className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{project.title}</h1>
            <p className="text-sm text-muted-foreground">
              {project.team_name} · <code className="text-xs">{project.slug}</code>
            </p>
            <div className="mt-2 max-w-2xl max-h-40 overflow-y-auto rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm text-muted-foreground prose prose-sm dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {project.description ?? ""}
              </ReactMarkdown>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold uppercase",
              project.status === "active"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-100 text-slate-600",
            )}
          >
            {project.status}
          </span>
          <button
            type="button"
            onClick={openEdit}
            title="Edit project"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            title="Delete project"
            className="inline-flex items-center gap-1.5 rounded-full border border-red-300/40 px-3 py-1 text-xs font-medium text-red-500 transition hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </header>

      {appTiles.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Apps</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {appTiles.map((tile) => {
              const Icon = tile.Icon;
              const inner = (
                <>
                  {tile.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tile.iconUrl}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-2xl object-cover shadow-sm"
                    />
                  ) : (
                    <span
                      className={cn(
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm",
                        tile.gradient,
                      )}
                    >
                      <Icon className="h-6 w-6" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground group-hover:text-primary">
                      {tile.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {tile.external ? "Open ↗" : "Open"}
                    </span>
                  </span>
                  {tile.external && (
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </>
              );
              const cls =
                "group flex items-center gap-3 rounded-2xl border border-border/60 bg-card/40 p-4 text-foreground no-underline transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent/40 hover:shadow-md";
              return tile.external ? (
                <a key={tile.key} href={tile.url} target="_blank" rel="noopener noreferrer" className={cls}>
                  {inner}
                </a>
              ) : (
                <Link key={tile.key} href={tile.url} className={cls}>
                  {inner}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Advanced details — hidden by default; power users only (integration
          refs + the Backstage catalog-info.yaml export). */}
      <details className="group rounded-2xl border border-border/50 bg-card/30">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          Advanced details
        </summary>
        <div className="space-y-5 border-t border-border/50 p-4">
          {integrations.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {integrations.map(({ label, url }) => (
                <div
                  key={label}
                  className="rounded-xl border border-border/50 bg-card/40 px-4 py-3 text-sm"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-1 break-all font-medium">{url}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Backstage catalog-info.yaml</h2>
              <button
                type="button"
                onClick={() => void copyYaml()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy YAML"}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-2xl border border-border/60 bg-slate-950 p-6 text-xs leading-relaxed text-emerald-100/90">
              {catalogYaml}
            </pre>
          </div>
        </div>
      </details>

      {project.member_ids.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold">Members</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {project.member_ids.map((member) => (
              <span
                key={member}
                className="rounded-full border border-border bg-muted/50 px-3 py-1 text-sm"
              >
                @{member}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-base font-semibold">Edit project</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              {sourceKinds.length > 0 ? (
                <div>
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">
                    Sources
                  </label>
                  <SourcesEditor
                    kinds={sourceKinds}
                    value={editSources}
                    onChange={setEditSources}
                  />
                </div>
              ) : null}
            </div>
            {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setEditOpen(false); setError(null); }}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-base font-semibold">Delete &ldquo;{project.title}&rdquo;?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Removes this project from CAIPE and, where configured, its connected external resources (e.g. its wiki space). This cannot be undone.
            </p>
            {error ? (
              <p className="mt-3 text-sm text-red-500">{error}</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
