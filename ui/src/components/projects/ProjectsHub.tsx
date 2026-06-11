"use client";

// assisted-by Cursor Composer

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  FolderKanban,
  RefreshCw,
  Rocket,
  Sparkles,
} from "lucide-react";

import { BackstageSyncDialog } from "@/components/projects/BackstageSyncDialog";
import { ProjectOnboardingWizard } from "@/components/projects/ProjectOnboardingWizard";
import { cn } from "@/lib/utils";
import type { ProjectDocument } from "@/types/projects";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-700 border-emerald-300",
  onboarding: "bg-amber-500/15 text-amber-700 border-amber-300",
  draft: "bg-slate-500/15 text-slate-600 border-slate-300",
  archived: "bg-muted text-muted-foreground border-border",
};

interface OnboardingHeroConfig {
  title: string;
  description: string;
}

export function ProjectsHub() {
  const [projects, setProjects] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hero, setHero] = useState<OnboardingHeroConfig>({
    title: "Projects for your teams",
    description:
      "Create projects aligned with your Backstage catalog. Onboarding steps are configured externally.",
  });
  const [syncOpen, setSyncOpen] = useState(false);
  const [canOpenSync, setCanOpenSync] = useState(false);
  // Blocked-reason is tracked for gating but not rendered (the Sync button is
  // simply hidden when the user can't sync).
  const [, setSyncBlockedReason] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Forward any label/search params (?domain=…&initiative=…&swimlane=…&q=…)
      // so dashboard drill-downs land on a filtered hub.
      const qs = typeof window !== "undefined" ? window.location.search : "";
      const res = await fetch(`/api/projects${qs}`);
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to load projects");
      }
      setProjects((body.data?.projects ?? []) as ProjectDocument[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    fetch("/api/projects/onboarding-config")
      .then((res) => res.json())
      .then((body) => {
        const config = body.data?.config;
        if (config?.hero) {
          setHero(config.hero);
        }
      })
      .catch(() => undefined);

    fetch("/api/projects/backstage/status")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        const data = body.data ?? {};
        const configured = Boolean(data.configured);
        const canManage = Boolean(data.can_manage);

        setCanOpenSync(configured && canManage);

        if (!configured) {
          setSyncBlockedReason(
            "Backstage is not configured on the server (BACKSTAGE_URL and BACKSTAGE_API_TOKEN).",
          );
          return;
        }
        if (!canManage) {
          setSyncBlockedReason("Org admin access required to import from Backstage.");
          return;
        }
        setSyncBlockedReason(null);
      })
      .catch(() => {
        setCanOpenSync(false);
        setSyncBlockedReason("Could not load Backstage sync status.");
      });
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-10 p-6">
      <section className="relative overflow-hidden rounded-3xl border border-primary/10 bg-gradient-to-br from-violet-950/40 via-background to-indigo-950/30 p-8 md:p-12">
        <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="relative grid gap-8 md:grid-cols-2 md:items-center">
          <div className="space-y-4">
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight md:text-4xl">
              <FolderKanban className="h-8 w-8 shrink-0 text-violet-400 md:h-9 md:w-9" />
              {hero.title}
            </h1>
            <p className="max-w-lg text-muted-foreground">{hero.description}</p>
          </div>
          <div className="flex flex-col items-stretch gap-3 md:items-end">
            <ProjectOnboardingWizard onComplete={() => void load()} />
            <Link
              href="/projects/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Sparkles className="h-4 w-4" />
              Executive Dashboard
            </Link>
            {canOpenSync ? (
              <button
                type="button"
                onClick={() => setSyncOpen(true)}
                title="Super admins can import kind: System entities from the Backstage developer portal, assign a team, and resolve conflicts before apply."
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className="h-4 w-4" />
                Sync from Backstage
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Your projects</h2>
          {!loading ? (
            <span className="text-sm text-muted-foreground">
              {projects.length} project{projects.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading projects…</p>
        ) : null}
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {!loading && projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <Rocket className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 font-medium">No projects yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a project with the onboarding wizard or import Systems from
              the Backstage catalog section above.
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={String(project._id)}
              href={`/projects/${project.slug}`}
              className="group rounded-2xl border border-border/60 bg-card/50 p-5 transition hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold group-hover:text-primary">{project.title}</h3>
                  <p className="text-xs text-muted-foreground">{project.team_name}</p>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                    STATUS_STYLES[project.status] ?? STATUS_STYLES.draft,
                  )}
                >
                  {project.status}
                </span>
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                {project.description}
              </p>
              {(() => {
                const chips = [
                  project.labels?.domain ?? project.domain,
                  ...(project.labels?.initiatives ?? []),
                  ...(project.labels?.swimlanes ?? []),
                ].filter(Boolean) as string[];
                return chips.length ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {chips.slice(0, 6).map((l, i) => (
                      <span
                        key={`${l}-${i}`}
                        className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                ) : null;
              })()}
              <div className="mt-4 flex items-center gap-1 text-xs font-medium text-primary">
                View catalogue
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <BackstageSyncDialog
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        onComplete={() => void load()}
      />
    </div>
  );
}
