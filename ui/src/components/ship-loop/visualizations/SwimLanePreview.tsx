"use client";

/**
 * SwimLanePreview
 *
 * A compact, decorative preview of the multi-swim-lane kanban
 * visualization (US2 / US4 mode B). Renders three lanes -- Implement,
 * Review (HITL), Deploy -- with mock task cards that drift across the
 * lane on a slow CSS animation, conveying "agents are moving work
 * through stages, live" without needing real data.
 *
 * This is the demo target while the real Kanban viz (T044-T058) is
 * still in flight. When that lands, this component remains useful as
 * a portfolio-level "activity sparkline" tile (T059-T066).
 *
 * Reduced-motion users get the static kanban -- the lane structure,
 * cards, and per-stage colors are themselves a meaningful preview.
 */

import {
  Code2,
  ShieldCheck,
  Rocket,
  GitPullRequest,
  Bot,
  User,
  type LucideIcon,
} from "lucide-react";
import { STAGE_VISUALS } from "@/components/ship-loop/visualizations/stage-visuals";
import type { ShipLoopStage } from "@/types/ship-loop";

interface MockCard {
  id: string;
  title: string;
  /** "agent" or "human" badge -- carries the AI-native signal. */
  actor: "agent" | "human";
  /** lucide icon for the card's leading affordance. */
  leadingIcon: LucideIcon;
  /** Animation delay in seconds, staggers the drift. */
  delaySec: number;
}

interface Lane {
  stage: ShipLoopStage;
  icon: LucideIcon;
  cards: MockCard[];
}

const LANES: Lane[] = [
  {
    stage: "implement",
    icon: Code2,
    cards: [
      {
        id: "i1",
        title: "Wire skills middleware",
        actor: "agent",
        leadingIcon: Bot,
        delaySec: 0,
      },
      {
        id: "i2",
        title: "Fix HITL oncall pager",
        actor: "agent",
        leadingIcon: GitPullRequest,
        delaySec: 1.2,
      },
    ],
  },
  {
    stage: "review_hitl",
    icon: ShieldCheck,
    cards: [
      {
        id: "r1",
        title: "Approve PR #482",
        actor: "human",
        leadingIcon: User,
        delaySec: 0.4,
      },
      {
        id: "r2",
        title: "Request changes on #491",
        actor: "human",
        leadingIcon: User,
        delaySec: 1.8,
      },
    ],
  },
  {
    stage: "deploy",
    icon: Rocket,
    cards: [
      {
        id: "d1",
        title: "Sandbox: rollout 7d2c",
        actor: "agent",
        leadingIcon: Rocket,
        delaySec: 0.8,
      },
    ],
  },
];

interface SwimLanePreviewProps {
  className?: string;
}

export function SwimLanePreview({ className }: SwimLanePreviewProps) {
  return (
    <div
      className={[
        "rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm",
        "p-3 sm:p-4 space-y-2",
        className ?? "",
      ].join(" ")}
      role="img"
      aria-label="Animated preview of the kanban-style ship loop visualization with three swim lanes — Implement, Review, Deploy — and agent and human task cards drifting across each lane"
    >
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="uppercase tracking-wider font-medium">
          Live swim lanes
        </span>
        <span className="flex items-center gap-1.5">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="motion-safe:animate-pulse absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          Streaming preview
        </span>
      </div>

      <div className="space-y-1.5">
        {LANES.map((lane) => (
          <SwimLane key={lane.stage} lane={lane} />
        ))}
      </div>
    </div>
  );
}

function SwimLane({ lane }: { lane: Lane }) {
  const visual = STAGE_VISUALS[lane.stage];
  const LaneIcon = lane.icon;

  return (
    <div className="flex items-stretch gap-2">
      {/* Lane header — fixed width so the cards can drift in a stable
          horizontal slot. */}
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

      {/* Lane track + drifting cards. overflow-hidden so a card whose
          drift carries it slightly past the right edge fades cleanly
          rather than blowing out the layout. */}
      <div className="relative flex-1 min-w-0 rounded-lg border border-border/30 bg-background/40 overflow-hidden h-9">
        {/* Faint grid hint — gives the lane a "track" feel. */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0 calc(33% - 1px), hsl(var(--border)) calc(33% - 1px) 33%, transparent 33% calc(66% - 1px), hsl(var(--border)) calc(66% - 1px) 66%, transparent 66%)",
          }}
        />

        <div className="absolute inset-0 flex items-center px-2 gap-2">
          {lane.cards.map((card) => (
            <DriftingCard key={card.id} card={card} stage={lane.stage} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DriftingCard({
  card,
  stage,
}: {
  card: MockCard;
  stage: ShipLoopStage;
}) {
  const visual = STAGE_VISUALS[stage];
  const LeadingIcon = card.leadingIcon;
  const isAgent = card.actor === "agent";

  return (
    <div
      className={[
        "relative shrink-0 inline-flex items-center gap-1.5",
        "px-2 py-1 rounded-md text-[11px] whitespace-nowrap",
        "border bg-card/80 backdrop-blur-sm",
        visual.borderClass,
        // The drift animation -- 60% of the lane width, so cards
        // visibly traverse without ever escaping the lane. CSS var
        // is consumed by the @keyframes definition in globals.css.
        "motion-safe:animate-ship-loop-card-drift",
      ].join(" ")}
      style={{
        // animation-delay staggers the lane to feel populated;
        // --drift sets the horizontal travel range the keyframe consumes.
        animationDelay: `${card.delaySec.toFixed(2)}s`,
        ["--drift" as string]: "60%",
      }}
    >
      <LeadingIcon className={["h-3 w-3", visual.fgClass].join(" ")} />
      <span className="text-foreground/80 font-medium">{card.title}</span>
      <span
        className={[
          "ml-1 px-1 py-px rounded text-[9px] uppercase tracking-wider font-semibold",
          isAgent
            ? "bg-primary/15 text-primary border border-primary/30"
            : "bg-amber-500/15 text-amber-300 border border-amber-500/30",
        ].join(" ")}
      >
        {isAgent ? "Agent" : "You"}
      </span>
    </div>
  );
}
