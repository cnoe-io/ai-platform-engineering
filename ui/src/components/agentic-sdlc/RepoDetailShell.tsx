"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { LiveStatusIndicator } from "@/components/agentic-sdlc/LiveStatusIndicator";
import { RepoEpicList } from "@/components/agentic-sdlc/RepoEpicList";
import { AgenticSdlcSimulationControl } from "@/components/agentic-sdlc/AgenticSdlcSimulationControl";
import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import { RepoEventFeed } from "@/components/agentic-sdlc/RepoEventFeed";
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
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4 md:p-6 lg:px-10">
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

      <section className="relative overflow-hidden rounded-2xl border border-border/40 bg-card/35 px-4 py-3">
        <div
          aria-hidden
          className="absolute -right-24 -top-28 h-56 w-56 rounded-full bg-primary/20 blur-3xl"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Repo detail view
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
              <span className="text-muted-foreground">{owner}/</span>
              <span className="text-foreground">{repo}</span>
            </h1>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Live agent lanes, Epics, review pressure, deploy signal, and webhook health.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RepoGitHubSyncControl owner={owner} repo={repo} />
            <LiveStatusIndicator status={repoLive.status} label="Repo live" />
          </div>
        </div>
      </section>

      <AgenticSdlcSimulationControl owner={owner} repo={repo} />

      <section aria-label="Repo operating board">
        <RepoSwimLanes owner={owner} repo={repo} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.5fr_0.8fr]">
        <CollapsiblePanel
          title="Epics"
          subtitle={
            <span className="flex items-center justify-between gap-3">
              <span>Drill into active loops and repo-level Epics.</span>
              <span className="text-[11px] text-muted-foreground/70">{fullName}</span>
            </span>
          }
          className="min-w-0"
        >
          <RepoEpicList owner={owner} repo={repo} />
        </CollapsiblePanel>

        <RepoOperatingMetrics owner={owner} repo={repo} />
      </section>

      <RepoEventFeed owner={owner} repo={repo} />
    </div>
  );
}
