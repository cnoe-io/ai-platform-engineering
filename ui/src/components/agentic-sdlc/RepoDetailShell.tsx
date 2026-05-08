"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { LiveStatusIndicator } from "@/components/agentic-sdlc/LiveStatusIndicator";
import { RepoEpicList } from "@/components/agentic-sdlc/RepoEpicList";
import { AgenticSdlcSimulationControl } from "@/components/agentic-sdlc/AgenticSdlcSimulationControl";
import { RepoGitHubSyncControl } from "@/components/agentic-sdlc/RepoGitHubSyncControl";
import { RepoOperatingMetrics } from "@/components/agentic-sdlc/RepoOperatingMetrics";
import { RepoSwimLanes } from "@/components/agentic-sdlc/RepoSwimLanes";
import { useRepoAgenticSdlcLiveRefresh } from "@/hooks/use-repo-agentic-sdlc-live-refresh";

// assisted-by Codex Codex-sonnet-4-6

interface RepoDetailShellProps {
  owner: string;
  repo: string;
}

export function RepoDetailShell({ owner, repo }: RepoDetailShellProps) {
  const fullName = `${owner}/${repo}`;
  const repoLive = useRepoAgenticSdlcLiveRefresh({ owner, repo, enabled: true });

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6 p-6 md:p-8 lg:px-12">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link href="/apps/agentic-sdlc" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Repos
        </Link>
        <span>/</span>
        <span className="text-foreground">{fullName}</span>
        <span className="ml-auto inline-flex gap-3">
          <Link href="/apps/agentic-sdlc?tab=metrics" className="hover:text-foreground">
            Metrics
          </Link>
          <Link href="/apps/agentic-sdlc?tab=settings" className="hover:text-foreground">
            Settings
          </Link>
        </span>
      </nav>

      <section className="relative overflow-hidden rounded-2xl border border-border/40 bg-card/35 p-5">
        <div
          aria-hidden
          className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/20 blur-3xl"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Repo detail view
            </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            <span className="text-muted-foreground">{owner}/</span>
            <span className="text-foreground">{repo}</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Command center for this repository: active Epics, live swim lanes,
            human review pressure, deploy signal, and webhook health.
          </p>
          </div>
          <LiveStatusIndicator status={repoLive.status} label="Repo live" />
        </div>
      </section>

      <RepoGitHubSyncControl owner={owner} repo={repo} />

      <AgenticSdlcSimulationControl owner={owner} repo={repo} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Live repo swim lanes
            </h2>
            <p className="mt-1 text-xs text-muted-foreground/75">
              Repo-scoped view of active agent and human work. This belongs here,
              not on the all-repos dashboard.
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground/70">
            {fullName}
          </span>
        </div>
        <RepoSwimLanes owner={owner} repo={repo} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.5fr_0.8fr]">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Epics
            </h2>
            <span className="text-[11px] text-muted-foreground/70">
              Drill into a loop
            </span>
          </div>
          <RepoEpicList owner={owner} repo={repo} />
        </div>

        <RepoOperatingMetrics owner={owner} repo={repo} />
      </section>
    </div>
  );
}
