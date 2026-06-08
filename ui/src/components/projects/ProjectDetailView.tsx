"use client";

// assisted-by Cursor Composer

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Copy, ExternalLink, FolderKanban } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ProjectDocument } from "@/types/projects";

export function ProjectDetailView({ slug }: { slug: string }) {
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [catalogYaml, setCatalogYaml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => ({
      label: key.replace(/_/g, " "),
      url: value,
    }));

  // Navigable app tiles from the *_url integrations (Context Graph, Agent Mesh…).
  const APP_LABELS: Record<string, string> = {
    context_graph: "LLM Wiki",
    agent_mesh: "Agent Mesh",
    webex: "Collaboration Space",
    pam: "Meeting Assistant",
    catalogue: "Software Catalogue",
  };
  const appTiles = Object.entries(project.integrations ?? {})
    .filter(([key, value]) => key.endsWith("_url") && Boolean(value))
    .map(([key, value]) => {
      const slug = key.replace(/_url$/, "");
      const url = String(value);
      return {
        key,
        label: APP_LABELS[slug] ?? slug.replace(/_/g, " "),
        url,
        external: /^https?:\/\//.test(url),
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
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white">
            <FolderKanban className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{project.title}</h1>
            <p className="text-sm text-muted-foreground">
              {project.team_name} · <code className="text-xs">{project.slug}</code>
            </p>
            <p className="mt-2 max-w-2xl text-muted-foreground">{project.description}</p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold uppercase",
            project.status === "active"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-amber-300 bg-amber-50 text-amber-700",
          )}
        >
          {project.status}
        </span>
      </header>

      {appTiles.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Apps</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {appTiles.map((tile) => {
              const inner = (
                <>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white">
                    <FolderKanban className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary">
                      {tile.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{tile.url}</span>
                  </span>
                  {tile.external && (
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </>
              );
              const cls =
                "group flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-foreground no-underline transition hover:border-primary/40 hover:bg-accent/40";
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

      {integrations.length > 0 ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Backstage catalog-info.yaml</h2>
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
        <p className="text-xs text-muted-foreground">
          Matches{" "}
          <a
            href="https://github.com/cisco-eti/outshift-platform-backstage-data"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            outshift-platform-backstage-data
            <ExternalLink className="h-3 w-3" />
          </a>{" "}
          folder layout under <code>domains/…/projects/</code>.
        </p>
      </section>

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
    </div>
  );
}
