"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, CircleDot, User } from "lucide-react";
import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import { STAGE_VISUALS } from "@/components/agentic-sdlc/visualizations/stage-visuals";
import type { AgenticSdlcStage, ArtifactKindStored } from "@/types/agentic-sdlc";

// assisted-by Codex Codex-sonnet-4-6

interface RepoSwimLaneItem {
  artifact_id: string;
  kind: ArtifactKindStored;
  title: string;
  current_stage: AgenticSdlcStage;
  actor_kind: "agent" | "human" | "system";
  agent_label: string | null;
  agent_name: string | null;
  status_label: string | null;
  escalation_labels: string[];
  github_url: string;
  last_event_at: string;
}

interface RepoSwimLane {
  stage: AgenticSdlcStage;
  items: RepoSwimLaneItem[];
}

interface AgentPersonaColumn {
  id: string;
  label: string;
  description: string;
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
    <div className="space-y-3">
      <CollapsiblePanel
        title="Agents in action"
        subtitle="Live work grouped by agent persona, with human escalations called out."
        className={className}
        titleClassName="text-primary"
        contentClassName="space-y-3"
      >
        <div className="flex justify-end text-[11px] text-muted-foreground">
          <ProjectedFromRepoEvents />
        </div>
        <AgentPersonaBoard status={status} visibleLanes={visibleLanes} />
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Live swim lanes"
        subtitle="Stage-based projection of active repo work from GitHub events."
        className="bg-card/25"
        contentClassName="space-y-2"
      >
        <div
          role="img"
          aria-label="Live Agentic SDLC swim lanes populated from projected repository artifacts"
        >
          <div className="mb-2 flex justify-end text-[11px] text-muted-foreground">
            <ProjectedFromRepoEvents />
          </div>
          <SwimLaneBody status={status} visibleLanes={visibleLanes} />
        </div>
      </CollapsiblePanel>
    </div>
  );
}

const AGENT_PERSONA_COLUMNS: Array<Omit<AgentPersonaColumn, "items">> = [
  {
    id: "architect",
    label: "Architect",
    description: "Shapes Epics, architecture, and operating direction.",
  },
  {
    id: "deep-think",
    label: "Deep Think",
    description: "Handles deeper analysis and ambiguous decisions.",
  },
  {
    id: "coder",
    label: "Coder",
    description: "Implements the active work items.",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    description: "Reviews PRs and change readiness.",
  },
  {
    id: "tester",
    label: "Tester",
    description: "Owns verification and test readiness.",
  },
  {
    id: "deployer",
    label: "Deployer",
    description: "Carries deploy and release work.",
  },
  {
    id: "human",
    label: "Human / Escalations",
    description: "Needs a person, decision, or access.",
  },
  {
    id: "system",
    label: "System",
    description: "Projected work without an agent owner.",
  },
];

function buildAgentPersonaColumns(lanes: RepoSwimLane[]): AgentPersonaColumn[] {
  const columns = AGENT_PERSONA_COLUMNS.map((column) => ({
    ...column,
    items: [] as RepoSwimLaneItem[],
  }));
  const byId = new Map(columns.map((column) => [column.id, column]));

  for (const lane of lanes) {
    for (const item of lane.items) {
      const columnId = agentPersonaColumnId(item);
      const column = byId.get(columnId) ?? byId.get("system");
      column?.items.push(item);
    }
  }

  return columns;
}

function agentPersonaColumnId(item: RepoSwimLaneItem): string {
  if ((item.escalation_labels ?? []).length > 0) return "human";
  if (!item.agent_name && item.actor_kind === "human") return "human";
  switch (item.agent_name) {
    case "Architect":
      return "architect";
    case "Deep Think":
      return "deep-think";
    case "Coder":
      return "coder";
    case "Reviewer":
      return "reviewer";
    case "Tester":
      return "tester";
    case "Deployer":
      return "deployer";
    default:
      return "system";
  }
}

function ProjectedFromRepoEvents() {
  return (
    <span className="hidden items-center gap-1.5 sm:flex">
      <span className="relative inline-flex h-1.5 w-1.5">
        <span className="motion-safe:animate-pulse absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      Projected from repo events
    </span>
  );
}

function SwimLaneBody({
  status,
  visibleLanes,
  expanded = false,
}: {
  status: "loading" | "ready" | "error";
  visibleLanes: RepoSwimLane[];
  expanded?: boolean;
}) {
  if (status === "loading") {
    return (
      <div className="rounded-lg border border-border/30 bg-background/40 px-3 py-5 text-xs text-muted-foreground">
        Loading projected artifacts...
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-5 text-xs text-destructive">
        Could not load live swim lanes.
      </div>
    );
  }
  if (visibleLanes.length === 0) {
    return (
      <div className="rounded-lg border border-border/30 bg-background/40 px-3 py-5 text-xs text-muted-foreground">
        No active projected artifacts yet. Create or update an Epic in this repo
        to populate these lanes.
      </div>
    );
  }
  return (
    <div className={expanded ? "space-y-3" : "space-y-1.5"}>
      {visibleLanes.map((lane) => (
        <LiveLane key={lane.stage} lane={lane} expanded={expanded} />
      ))}
    </div>
  );
}

function AgentPersonaBoard({
  status,
  visibleLanes,
}: {
  status: "loading" | "ready" | "error";
  visibleLanes: RepoSwimLane[];
}) {
  if (status !== "ready" || visibleLanes.length === 0) {
    return <SwimLaneBody status={status} visibleLanes={visibleLanes} expanded />;
  }

  const columns = buildAgentPersonaColumns(visibleLanes);
  const activeColumns = columns.filter(
    (column) => column.items.length > 0 || column.id !== "system",
  );

  return (
    <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
      {activeColumns.map((column) => (
        <section
          key={column.id}
          className="flex min-h-52 flex-col rounded-xl border border-border/40 bg-background/35"
          aria-label={`${column.label} work`}
        >
          <header className="border-b border-border/35 p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">
                {column.label}
              </h4>
              <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {column.items.length}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {column.description}
            </p>
          </header>

          <div className="flex flex-1 flex-col gap-2 p-2">
            {column.items.length === 0 ? (
              <div className="flex min-h-24 flex-1 items-center justify-center rounded-lg border border-dashed border-border/35 bg-card/20 px-3 text-center text-[11px] text-muted-foreground">
                No active work for this persona.
              </div>
            ) : (
              column.items.map((item) => (
                <LiveLaneCard
                  key={item.artifact_id}
                  item={item}
                  stage={item.current_stage}
                  expanded
                />
              ))
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function LiveLane({ lane, expanded = false }: { lane: RepoSwimLane; expanded?: boolean }) {
  const visual = STAGE_VISUALS[lane.stage] ?? STAGE_VISUALS.unknown;
  const LaneIcon = visual.icon;
  const visibleItems = expanded ? lane.items : lane.items.slice(0, 6);
  const hiddenCount = Math.max(0, lane.items.length - visibleItems.length);

  return (
    <div className={expanded ? "flex flex-col gap-2 xl:flex-row" : "flex items-stretch gap-2"}>
      <div
        className={[
          expanded
            ? "flex w-full shrink-0 items-center gap-2 rounded-lg border px-3 py-2 xl:w-52"
            : "shrink-0 w-32 sm:w-40 rounded-lg border px-2.5 py-2 flex items-center gap-2",
          visual.bgClass,
          visual.borderClass,
        ].join(" ")}
      >
        <LaneIcon className={["h-3.5 w-3.5", visual.fgClass].join(" ")} />
        <span className="text-[11px] font-semibold tracking-tight">
          {visual.label}
        </span>
      </div>

      <div className={expanded ? "relative min-h-24 min-w-0 flex-1 overflow-hidden rounded-lg border border-border/30 bg-background/40" : "relative flex-1 min-w-0 rounded-lg border border-border/30 bg-background/40 overflow-hidden min-h-10"}>
        <div
          aria-hidden
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0 calc(33% - 1px), hsl(var(--border)) calc(33% - 1px) 33%, transparent 33% calc(66% - 1px), hsl(var(--border)) calc(66% - 1px) 66%, transparent 66%)",
          }}
        />
        <div className={expanded ? "relative flex flex-wrap items-start gap-3 p-3" : "relative flex flex-wrap items-center gap-2 p-2"}>
          {visibleItems.map((item) => (
            <LiveLaneCard
              key={item.artifact_id}
              item={item}
              stage={lane.stage}
              expanded={expanded}
            />
          ))}
          {hiddenCount > 0 && !expanded && (
            <span
              className="rounded-md border border-border/40 bg-muted/30 px-2 py-1 text-[11px] font-medium text-muted-foreground"
              title="Use Expand to see every work item in this lane"
            >
              +{hiddenCount} more
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveLaneCard({
  item,
  stage,
  expanded = false,
}: {
  item: RepoSwimLaneItem;
  stage: AgenticSdlcStage;
  expanded?: boolean;
}) {
  const visual = STAGE_VISUALS[stage] ?? STAGE_VISUALS.unknown;
  const escalationLabels = item.escalation_labels ?? [];
  const ActorIcon =
    item.actor_kind === "agent" ? Bot : item.actor_kind === "human" ? User : CircleDot;

  return (
    <a
      href={item.github_url}
      target="_blank"
      rel="noreferrer"
      className={[
        expanded
          ? "relative flex w-full max-w-sm flex-col gap-2 rounded-lg border bg-card/80 px-3 py-2.5"
          : "relative inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card/80 px-2 py-1",
        "text-[11px] backdrop-blur-sm transition hover:bg-card",
        visual.borderClass,
      ].join(" ")}
      title={item.title}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <ActorIcon className={["h-3 w-3 shrink-0", visual.fgClass].join(" ")} />
        <span className="truncate font-medium text-foreground/80">{item.title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <AgentBadge item={item} />
        {item.status_label && (
          <span className="rounded border border-sky-400/25 bg-sky-400/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-sky-200">
            {item.status_label.replace("status:", "")}
          </span>
        )}
        {escalationLabels.map((label) => (
          <span
            key={label}
            className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-200"
          >
            {label.replace("needs:", "needs ")}
          </span>
        ))}
      </div>
    </a>
  );
}

function AgentBadge({ item }: { item: RepoSwimLaneItem }) {
  const label = item.agent_name
    ? item.agent_name
    : item.actor_kind === "human"
      ? "Human"
      : item.actor_kind === "agent"
        ? "Agent"
        : "System";
  return (
    <span
      className={[
        "shrink-0 rounded border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider",
        item.actor_kind === "human" && !item.agent_name
          ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
          : item.agent_name || item.actor_kind === "agent"
            ? "border-primary/30 bg-primary/15 text-primary"
            : "border-border/40 bg-muted/40 text-muted-foreground",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

export const _internal = {
  buildAgentPersonaColumns,
};
