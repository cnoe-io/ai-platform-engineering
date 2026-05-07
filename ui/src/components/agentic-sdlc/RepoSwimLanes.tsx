"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, CircleDot, User } from "lucide-react";
import { STAGE_VISUALS } from "@/components/agentic-sdlc/visualizations/stage-visuals";
import type { AgenticSdlcStage, ArtifactKindStored } from "@/types/agentic-sdlc";

// assisted-by Codex Codex-sonnet-4-6

interface RepoSwimLaneItem {
  artifact_id: string;
  kind: ArtifactKindStored;
  title: string;
  current_stage: AgenticSdlcStage;
  actor_kind: "agent" | "human" | "system";
  github_url: string;
  last_event_at: string;
}

interface RepoSwimLane {
  stage: AgenticSdlcStage;
  items: RepoSwimLaneItem[];
}

interface RepoSummaryResponse {
  swim_lanes?: RepoSwimLane[];
}

interface RepoSwimLanesProps {
  owner: string;
  repo: string;
  className?: string;
}

export function RepoSwimLanes({ owner, repo, className }: RepoSwimLanesProps) {
  const [lanes, setLanes] = useState<RepoSwimLane[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    function onRepoSynced(event: Event) {
      const detail = (event as CustomEvent<{ owner?: string; repo?: string }>).detail;
      if (detail?.owner === owner && detail?.repo === repo) {
        setRefreshKey((value) => value + 1);
      }
    }
    window.addEventListener("agentic-sdlc:repo-synced", onRepoSynced);
    return () => window.removeEventListener("agentic-sdlc:repo-synced", onRepoSynced);
  }, [owner, repo]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      try {
        const res = await fetch(
          `/api/agentic-sdlc/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as RepoSummaryResponse;
        if (!cancelled) {
          setLanes(body.swim_lanes ?? []);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [owner, repo, refreshKey]);

  const visibleLanes = useMemo(
    () =>
      lanes.filter(
        (lane) => lane.stage !== "unknown" && lane.items.length > 0,
      ),
    [lanes],
  );

  return (
    <div
      className={[
        "rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm",
        "p-3 sm:p-4 space-y-2",
        className ?? "",
      ].join(" ")}
      role="img"
      aria-label="Live Agentic SDLC swim lanes populated from projected repository artifacts"
    >
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="uppercase tracking-wider font-medium">Live swim lanes</span>
        <span className="flex items-center gap-1.5">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="motion-safe:animate-pulse absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          Projected from repo events
        </span>
      </div>

      {status === "loading" ? (
        <div className="rounded-lg border border-border/30 bg-background/40 px-3 py-5 text-xs text-muted-foreground">
          Loading projected artifacts...
        </div>
      ) : status === "error" ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-5 text-xs text-destructive">
          Could not load live swim lanes.
        </div>
      ) : visibleLanes.length === 0 ? (
        <div className="rounded-lg border border-border/30 bg-background/40 px-3 py-5 text-xs text-muted-foreground">
          No active projected artifacts yet. Create or update an Epic in this repo
          to populate these lanes.
        </div>
      ) : (
        <div className="space-y-1.5">
          {visibleLanes.map((lane) => (
            <LiveLane key={lane.stage} lane={lane} />
          ))}
        </div>
      )}
    </div>
  );
}

function LiveLane({ lane }: { lane: RepoSwimLane }) {
  const visual = STAGE_VISUALS[lane.stage] ?? STAGE_VISUALS.unknown;
  const LaneIcon = visual.icon;

  return (
    <div className="flex items-stretch gap-2">
      <div
        className={[
          "shrink-0 w-32 sm:w-40 rounded-lg border px-2.5 py-2 flex items-center gap-2",
          visual.bgClass,
          visual.borderClass,
        ].join(" ")}
      >
        <LaneIcon className={["h-3.5 w-3.5", visual.fgClass].join(" ")} />
        <span className="text-[11px] font-semibold tracking-tight">
          {visual.label}
        </span>
      </div>

      <div className="relative flex-1 min-w-0 rounded-lg border border-border/30 bg-background/40 overflow-hidden min-h-10">
        <div
          aria-hidden
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0 calc(33% - 1px), hsl(var(--border)) calc(33% - 1px) 33%, transparent 33% calc(66% - 1px), hsl(var(--border)) calc(66% - 1px) 66%, transparent 66%)",
          }}
        />
        <div className="relative flex flex-wrap items-center gap-2 p-2">
          {lane.items.map((item) => (
            <LiveLaneCard key={item.artifact_id} item={item} stage={lane.stage} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LiveLaneCard({
  item,
  stage,
}: {
  item: RepoSwimLaneItem;
  stage: AgenticSdlcStage;
}) {
  const visual = STAGE_VISUALS[stage] ?? STAGE_VISUALS.unknown;
  const ActorIcon =
    item.actor_kind === "agent" ? Bot : item.actor_kind === "human" ? User : CircleDot;

  return (
    <a
      href={item.github_url}
      target="_blank"
      rel="noreferrer"
      className={[
        "relative inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card/80 px-2 py-1",
        "text-[11px] backdrop-blur-sm transition hover:bg-card",
        visual.borderClass,
      ].join(" ")}
      title={item.title}
    >
      <ActorIcon className={["h-3 w-3 shrink-0", visual.fgClass].join(" ")} />
      <span className="truncate text-foreground/80 font-medium">{item.title}</span>
      <span
        className={[
          "ml-1 shrink-0 rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wider",
          item.actor_kind === "human"
            ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
            : item.actor_kind === "agent"
              ? "border-primary/30 bg-primary/15 text-primary"
              : "border-border/40 bg-muted/40 text-muted-foreground",
        ].join(" ")}
      >
        {item.actor_kind === "human"
          ? "You"
          : item.actor_kind === "agent"
            ? "Agent"
            : "System"}
      </span>
    </a>
  );
}
