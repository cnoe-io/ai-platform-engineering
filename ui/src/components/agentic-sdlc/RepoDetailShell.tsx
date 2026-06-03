"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { AgenticSdlcLayoutHost } from "@/components/agentic-sdlc/AgenticSdlcLayoutHost";
import { AgenticSdlcSimulationControl } from "@/components/agentic-sdlc/AgenticSdlcSimulationControl";
import { CommandPalette } from "@/components/agentic-sdlc/CommandPalette";
import { LiveStatusIndicator } from "@/components/agentic-sdlc/LiveStatusIndicator";
import { PanelChooser } from "@/components/agentic-sdlc/PanelChooser";
import { RepoCatchUpTimeline } from "@/components/agentic-sdlc/RepoCatchUpTimeline";
import { RepoGitHubSyncControl } from "@/components/agentic-sdlc/RepoGitHubSyncControl";
import { ShipLoopRingPanel } from "@/components/agentic-sdlc/panels/ShipLoopRingPanel";
import { useFaviconHealth } from "@/hooks/use-favicon-health";
import { useRepoAgenticSdlcLiveRefresh } from "@/hooks/use-repo-agentic-sdlc-live-refresh";
import { usePanelPreferences } from "@/hooks/use-panel-preferences";
import { resolvePanelLayout } from "@/lib/agentic-sdlc/panel-preferences";

// assisted-by Codex Codex-sonnet-4-6

interface RepoDetailShellProps {
  owner: string;
  repo: string;
}

export function RepoDetailShell({ owner, repo }: RepoDetailShellProps) {
  const fullName = `${owner}/${repo}`;
  const repoLive = useRepoAgenticSdlcLiveRefresh({ owner, repo, enabled: true });
  const prefs = usePanelPreferences({ surface: "repo_detail" });
  const layout = useMemo(
    () => resolvePanelLayout(prefs.preferences),
    [prefs.preferences],
  );
  useFaviconHealth();

  const heroPanels = layout.hero ?? [];
  const showHeroRing = heroPanels.includes("ship_loop_ring");

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 p-3 md:p-4 lg:px-8">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <Link
          href="/apps/agentic-sdlc"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Repos
        </Link>
        <span>/</span>
        <span className="text-foreground">{fullName}</span>
        <span className="ml-auto inline-flex gap-3">
          <Link
            href="/apps/agentic-sdlc?tab=metrics"
            className="hover:text-foreground"
          >
            Metrics
          </Link>
          <Link
            href="/apps/agentic-sdlc?tab=settings"
            className="hover:text-foreground"
          >
            Settings
          </Link>
        </span>
      </nav>

      <section className="relative overflow-hidden rounded-2xl border border-border/40 bg-card/35 px-4 py-2.5">
        <div
          aria-hidden
          className="absolute -right-24 -top-28 h-56 w-56 rounded-full bg-primary/20 blur-3xl"
        />
        {showHeroRing && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:block"
          >
            <ShipLoopRingPanel owner={owner} repo={repo} variant="mini" />
          </div>
        )}
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
              Live agent lanes, Epics, review pressure, deploy signal, and
              webhook health. Configure the panels you want with the chooser
              below.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RepoGitHubSyncControl owner={owner} repo={repo} />
            <RepoCatchUpTimeline owner={owner} repo={repo} />
            <LiveStatusIndicator status={repoLive.status} label="Repo live" />
          </div>
        </div>
      </section>

      <PanelChooser
        surface="repo_detail"
        preferences={prefs.preferences}
        isSaving={prefs.isSaving}
        lastSavedAt={prefs.lastSavedAt}
        onToggle={prefs.togglePanel}
        onMove={prefs.movePanel}
        onReset={prefs.reset}
        onToggleGrid={prefs.setGridEnabled}
        onResetGrid={prefs.resetGrid}
      />

      <AgenticSdlcSimulationControl owner={owner} repo={repo} />

      <AgenticSdlcLayoutHost
        surface="repo_detail"
        prefs={prefs}
        context={{ owner, repo, fullName }}
        excludePanelIds={["ship_loop_ring"]}
      />

      <CommandPalette />
    </div>
  );
}
