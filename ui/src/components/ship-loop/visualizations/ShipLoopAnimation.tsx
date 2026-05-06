"use client";

/**
 * ShipLoopAnimation
 *
 * A single, dependency-free SVG hero showing the eight ship-loop stages
 * laid out as an elliptical track with three agent "tokens" orbiting
 * along it (full ellipse — they go forward through the active stages
 * AND back through the feedback arc, which is the loop part of "ship
 * loop"), plus a glowing core that pulses while agents are at work.
 *
 * Why pure SVG:
 *   - No new dependency. Matches the plan: only the dependency-graph
 *     mode uses `@xyflow/react`; the rest is plain SVG / CSS.
 *   - SVG `animateMotion` gives us pixel-accurate orbit paths for free.
 *   - Reduced-motion users still get the full static diagram (which is
 *     itself a meaningful at-a-glance picture of the loop) because we
 *     guard every keyframe-driven animation behind motion-safe and
 *     gate `animateMotion` via `usePrefersReducedMotion`.
 *
 * Re-use intent:
 *   This component is also the visual primitive that the eventual
 *   "Ship-loop radar" mode (US4) and the empty-state of the Pipeline
 *   mode (US2) will lean on. The shape of `STAGE_VISUALS` plus the
 *   `ORBIT_STAGES` order is the contract those modes will read from.
 */

import { useId } from "react";
import {
  ORBIT_STAGES,
  STAGE_VISUALS,
} from "@/components/ship-loop/visualizations/stage-visuals";
import { usePrefersReducedMotion } from "@/components/ship-loop/visualizations/use-prefers-reduced-motion";

interface ShipLoopAnimationProps {
  className?: string;
  /**
   * If true, draw the orbiting agent tokens. Defaults to true. Caller
   * can flip this off in dense layouts where the static stage nodes
   * are enough.
   */
  showAgents?: boolean;
}

const VIEWBOX_W = 800;
const VIEWBOX_H = 360;
const CENTER_X = VIEWBOX_W / 2;
const CENTER_Y = VIEWBOX_H / 2;
const RADIUS_X = 320;
const RADIUS_Y = 130;

/** Orbit position (0..1) -> SVG coordinates on the upper arc (Specify -> Observe). */
function upperArcPoint(t: number): { x: number; y: number } {
  // Map t in [0..1] from -PI (left) to 0 (right), staying on the upper
  // half of the ellipse where Specify (left) -> Observe (right) live.
  const angle = -Math.PI + t * Math.PI;
  return {
    x: CENTER_X + RADIUS_X * Math.cos(angle),
    y: CENTER_Y + RADIUS_Y * Math.sin(angle),
  };
}

export function ShipLoopAnimation({
  className,
  showAgents = true,
}: ShipLoopAnimationProps) {
  // useId so multiple instances don't clash on gradient/filter ids.
  const idPrefix = useId().replace(/:/g, "");
  const trackGradId = `${idPrefix}-track`;
  const glowFilterId = `${idPrefix}-glow`;
  const tokenGradId = `${idPrefix}-token`;
  const orbitPathId = `${idPrefix}-orbit`;

  const prefersReducedMotion = usePrefersReducedMotion();

  const stageNodes = ORBIT_STAGES.map((stage) => {
    const visual = STAGE_VISUALS[stage];
    const { x, y } = upperArcPoint(visual.orbitPos);
    return { stage, visual, x, y };
  });

  return (
    <div
      className={["relative w-full", className ?? ""].join(" ")}
      role="img"
      aria-label="Animated diagram of the agentic SDLC ship loop with eight stages from Specify to Observe and a feedback arc returning to Specify"
    >
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Track gradient — AG-UI palette (teal -> purple -> magenta). */}
          <linearGradient id={trackGradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(var(--gradient-start))" />
            <stop offset="50%" stopColor="hsl(var(--gradient-mid))" />
            <stop offset="100%" stopColor="hsl(var(--gradient-end))" />
          </linearGradient>

          {/* Soft glow for stage nodes and the core. */}
          <filter id={glowFilterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Radial gradient for the orbiting agent tokens. */}
          <radialGradient id={tokenGradId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="1" />
            <stop offset="60%" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </radialGradient>

          {/* Hidden full-ellipse path that the agent tokens follow. */}
          <path id={orbitPathId} d={describeFullEllipse()} fill="none" />
        </defs>

        {/* Outer faint orbit hint — gives the loop a sense of full revolution. */}
        <ellipse
          cx={CENTER_X}
          cy={CENTER_Y}
          rx={RADIUS_X}
          ry={RADIUS_Y}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth="1"
          strokeDasharray="2 6"
          opacity="0.35"
        />

        {/* Active arc — Specify -> Observe along the upper half. */}
        <path
          d={describeUpperArc()}
          fill="none"
          stroke={`url(#${trackGradId})`}
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.85"
        />

        {/* Feedback arc — Observe -> Specify along the lower half (the
            "loop" part of ship loop). */}
        <path
          d={describeLowerArc()}
          fill="none"
          stroke={`url(#${trackGradId})`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="6 8"
          opacity="0.45"
        />

        {/* Animated dash flow on the feedback arc to convey "observed
            reality flows back into the next spec". Disabled under
            reduced motion via the motion-safe variant. */}
        <path
          d={describeLowerArc()}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="2 14"
          opacity="0.7"
          className="motion-safe:animate-ship-loop-dash"
        />

        {/* Stage nodes. */}
        {stageNodes.map(({ stage, visual, x, y }, i) => (
          <g key={stage} transform={`translate(${x} ${y})`}>
            {/* Halo — pulses to suggest live activity. */}
            <circle
              r="22"
              fill={`hsl(${visual.hsl} / 0.18)`}
              className="motion-safe:animate-ship-loop-halo origin-center"
              style={{ animationDelay: `${(i * 0.18).toFixed(2)}s` }}
            />
            <circle
              r="9"
              fill={`hsl(${visual.hsl})`}
              filter={`url(#${glowFilterId})`}
            />
            <text
              y={visual.orbitPos < 0.5 ? -34 : 36}
              textAnchor="middle"
              className="fill-foreground text-[12px] font-semibold tracking-tight"
            >
              {visual.label}
            </text>
            {/* Stage blurb on the far ends only, to avoid clutter. */}
            {(stage === "specify" || stage === "observe") && (
              <text
                y={visual.orbitPos < 0.5 ? -50 : 52}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {visual.blurb}
              </text>
            )}
          </g>
        ))}

        {/* Glowing core — visual anchor + "the loop is alive" pulse. */}
        <g transform={`translate(${CENTER_X} ${CENTER_Y})`}>
          <circle
            r="46"
            fill="hsl(var(--primary) / 0.08)"
            className="motion-safe:animate-ship-loop-core origin-center"
          />
          <circle r="22" fill="hsl(var(--primary) / 0.22)" />
          <circle r="6" fill="hsl(var(--primary))" filter={`url(#${glowFilterId})`} />
        </g>

        {/* Orbiting agent tokens — three of them, staggered, tracing
            the full ellipse via SVG animateMotion (which natively
            handles the curve and respects begin/keyTimes/dur).
            We omit the animateMotion entirely under reduced motion so
            assistive tech does not see "moving" content. */}
        {showAgents && (
          <g aria-hidden>
            {[0, 0.33, 0.66].map((delay, i) => (
              <circle key={i} r="8" fill={`url(#${tokenGradId})`}>
                {!prefersReducedMotion && (
                  <animateMotion
                    dur="9s"
                    repeatCount="indefinite"
                    rotate="auto"
                    begin={`-${(delay * 9).toFixed(2)}s`}
                  >
                    <mpath href={`#${orbitPathId}`} />
                  </animateMotion>
                )}
              </circle>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// path helpers — kept exported for tests and for future viz modes that
// want to reuse the same ellipse geometry.
// ---------------------------------------------------------------------------

export function describeUpperArc(): string {
  const start = upperArcPoint(0);
  const end = upperArcPoint(1);
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} A ${RADIUS_X} ${RADIUS_Y} 0 0 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

export function describeLowerArc(): string {
  const start = upperArcPoint(1);
  const end = upperArcPoint(0);
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} A ${RADIUS_X} ${RADIUS_Y} 0 0 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

/**
 * Full ellipse path expressed as two semicircular arcs — needed because
 * SVG arc commands cannot draw a full circle in a single segment. The
 * agent tokens follow this via `<mpath>` and naturally traverse forward
 * through the active stages and back through the feedback arc.
 */
export function describeFullEllipse(): string {
  const left = upperArcPoint(0);
  const right = upperArcPoint(1);
  return [
    `M ${left.x.toFixed(1)} ${left.y.toFixed(1)}`,
    `A ${RADIUS_X} ${RADIUS_Y} 0 0 1 ${right.x.toFixed(1)} ${right.y.toFixed(1)}`,
    `A ${RADIUS_X} ${RADIUS_Y} 0 0 1 ${left.x.toFixed(1)} ${left.y.toFixed(1)}`,
    "Z",
  ].join(" ");
}
