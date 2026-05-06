"use client";

/**
 * ShipLoopAnimation
 *
 * A single, dependency-free SVG hero showing the eight ship-loop stages
 * laid out as a horizontal pipeline (Specify -> Observe, left to right)
 * with a curved feedback path returning from Observe back to Specify
 * underneath (the "loop" part of ship loop). Agent tokens flow along
 * the pipeline left-to-right and curve back along the feedback line,
 * giving a clear visual narrative: forward progress through stages,
 * then learnings flow back into the next iteration.
 *
 * Why pure SVG:
 *   - No new dependency. Matches the plan: only the dependency-graph
 *     mode uses `@xyflow/react`; the rest is plain SVG / CSS.
 *   - SVG `animateMotion` gives us pixel-accurate motion paths for free.
 *   - Reduced-motion users still get the full static diagram (which is
 *     itself a meaningful at-a-glance picture of the loop) because we
 *     guard every keyframe-driven animation behind motion-safe and
 *     gate `animateMotion` via `usePrefersReducedMotion`.
 *
 * History:
 *   The original layout was an elliptical orbit. User feedback
 *   ("can we create a linear pipeline with a loop animation?") drove
 *   the move to a horizontal pipeline + return-loop. The exported
 *   path helpers were renamed accordingly; the loop topology
 *   (forward + feedback) is preserved end-to-end.
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

// Pipeline geometry. Coordinates are SVG units; the rendered size is
// driven by viewBox + responsive width on the wrapper.
//
// The loop is laid out as a rectangle:
//   - Top edge:   forward pipeline, Specify -> Observe (left to right)
//   - Right edge: corner down to the return rail
//   - Bottom edge: feedback rail, right to left
//   - Left edge:  corner up returning to Specify
//
// Corners are rounded with CORNER_R so the path reads as one
// continuous flow rather than four disconnected segments.
const VIEWBOX_W = 880;
const VIEWBOX_H = 260;
const PIPELINE_Y = 90; // Y of the top (forward) rail.
const FEEDBACK_Y = 200; // Y of the bottom (feedback) rail.
const STAGE_LEFT = 60;
const STAGE_RIGHT = VIEWBOX_W - 60;
const CORNER_R = 22; // corner radius for the rectangular path.

/** Pipeline position (0..1) -> SVG coordinates on the top rail. */
function pipelinePoint(t: number): { x: number; y: number } {
  return {
    x: STAGE_LEFT + (STAGE_RIGHT - STAGE_LEFT) * t,
    y: PIPELINE_Y,
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
  const flowPathId = `${idPrefix}-flow`;

  const prefersReducedMotion = usePrefersReducedMotion();

  const stageNodes = ORBIT_STAGES.map((stage) => {
    const visual = STAGE_VISUALS[stage];
    const { x, y } = pipelinePoint(visual.orbitPos);
    return { stage, visual, x, y };
  });

  return (
    <div
      className={["relative w-full", className ?? ""].join(" ")}
      role="img"
      aria-label="Animated diagram of the agentic SDLC ship loop: a horizontal pipeline of eight stages from Specify to Observe, with a feedback arc looping back from Observe to Specify"
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

          {/* Soft glow for stage nodes. */}
          <filter id={glowFilterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Radial gradient for the agent tokens. */}
          <radialGradient id={tokenGradId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="1" />
            <stop offset="60%" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </radialGradient>

          {/* Hidden full-loop path the agent tokens follow: top rail
              forward, right corner + down, bottom rail right-to-left,
              left corner + up. The path is one continuous rounded
              rectangle so animateMotion gives a smooth flow with no
              visible seam. */}
          <path id={flowPathId} d={describeFullLoop()} fill="none" />

          {/* Reusable arrow marker for direction cues along the
              non-stage edges (right, bottom, left). Defined as a
              <marker> so each consumer line gets a clean head
              without us hand-drawing rotated triangles. The marker
              auto-orients to the line's tangent. */}
          <marker
            id={`${idPrefix}-arrow`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              fill="hsl(var(--gradient-mid))"
              opacity="0.85"
            />
          </marker>
        </defs>

        {/* Top rail -- the forward pipeline. The stage icon discs
            sit on top of this. */}
        <line
          x1={STAGE_LEFT}
          y1={PIPELINE_Y}
          x2={STAGE_RIGHT}
          y2={PIPELINE_Y}
          stroke={`url(#${trackGradId})`}
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.9"
        />

        {/* Right edge -- corner from the top rail down to the
            feedback rail, with an arrow at the bottom indicating
            "flow turns the corner here". The path uses a quadratic
            bezier for the corner so the turn reads as continuous,
            not pixelated. */}
        <path
          d={`M ${STAGE_RIGHT} ${PIPELINE_Y} Q ${STAGE_RIGHT + CORNER_R} ${PIPELINE_Y}, ${STAGE_RIGHT + CORNER_R} ${PIPELINE_Y + CORNER_R} L ${STAGE_RIGHT + CORNER_R} ${FEEDBACK_Y - CORNER_R} Q ${STAGE_RIGHT + CORNER_R} ${FEEDBACK_Y}, ${STAGE_RIGHT} ${FEEDBACK_Y}`}
          fill="none"
          stroke="hsl(var(--gradient-end) / 0.6)"
          strokeWidth="1.5"
          strokeLinecap="round"
          markerEnd={`url(#${idPrefix}-arrow)`}
        />

        {/* Bottom rail -- the feedback line, right to left. Dashed
            so it reads visually distinct from the solid forward
            rail, and labelled below so the meaning is obvious
            without leaning on tooltips. The dash-flow animation
            (motion-safe only) creeps right-to-left to reinforce the
            return direction. */}
        <line
          x1={STAGE_RIGHT}
          y1={FEEDBACK_Y}
          x2={STAGE_LEFT}
          y2={FEEDBACK_Y}
          stroke="hsl(var(--gradient-mid) / 0.55)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="6 6"
          markerEnd={`url(#${idPrefix}-arrow)`}
        />
        <line
          x1={STAGE_RIGHT}
          y1={FEEDBACK_Y}
          x2={STAGE_LEFT}
          y2={FEEDBACK_Y}
          stroke="hsl(var(--primary) / 0.55)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="2 14"
          className="motion-safe:animate-ship-loop-dash"
        />

        {/* Left edge -- corner up from the feedback rail back to the
            top rail. Mirror image of the right edge. */}
        <path
          d={`M ${STAGE_LEFT} ${FEEDBACK_Y} Q ${STAGE_LEFT - CORNER_R} ${FEEDBACK_Y}, ${STAGE_LEFT - CORNER_R} ${FEEDBACK_Y - CORNER_R} L ${STAGE_LEFT - CORNER_R} ${PIPELINE_Y + CORNER_R} Q ${STAGE_LEFT - CORNER_R} ${PIPELINE_Y}, ${STAGE_LEFT} ${PIPELINE_Y}`}
          fill="none"
          stroke="hsl(var(--gradient-start) / 0.6)"
          strokeWidth="1.5"
          strokeLinecap="round"
          markerEnd={`url(#${idPrefix}-arrow)`}
        />

        {/* Stage nodes -- each rendered as the canonical Lucide icon
            for that stage, on a colored disc, so the visual is the
            same vocabulary the inline rail and per-Epic views use.
            The icon SVG is positioned via x/y on the Lucide element
            itself (Lucide icons accept SVG-standard positioning). */}
        {stageNodes.map(({ stage, visual, x, y }, i) => {
          const Icon = visual.icon;
          return (
            <g key={stage} transform={`translate(${x} ${y})`} data-stage={stage}>
              {/* Halo -- subtle, low-amplitude pulse to suggest live
                  activity without competing with the main animation.
                  Opacity is intentionally faint so the icon disc
                  always wins for visual hierarchy. */}
              <circle
                r="26"
                fill={`hsl(${visual.hsl} / 0.12)`}
                className="motion-safe:animate-ship-loop-halo-soft origin-center"
                style={{ animationDelay: `${(i * 0.25).toFixed(2)}s` }}
              />
              {/* Disc backdrop -- gives the icon a solid plate so it
                  reads against the page's gradient mesh. The disc
                  uses the stage's HSL token at high opacity, the
                  icon strokes white so it's legible on every disc. */}
              <circle
                r="18"
                fill={`hsl(${visual.hsl})`}
                filter={`url(#${glowFilterId})`}
              />
              {/* Lucide icon. The component renders an <svg> root;
                  nesting <svg> inside <svg> is valid SVG2 and is
                  positioned via x/y on the inner svg element. We
                  also lock width/height so the icon scales with the
                  parent viewBox rather than its intrinsic 24px. */}
              <Icon
                x={-12}
                y={-12}
                width={24}
                height={24}
                strokeWidth={2.25}
                color="white"
                aria-hidden
              />
              {/* Alternate label position above/below to avoid the
                  neighbours crashing into each other on narrow
                  renders. Even-indexed stages go above, odd-indexed
                  below. */}
              <text
                y={i % 2 === 0 ? -36 : 44}
                textAnchor="middle"
                className="fill-foreground text-[14px] font-semibold tracking-tight"
              >
                {visual.label}
              </text>
            </g>
          );
        })}

        {/* Loop label tucked just under the feedback rail so the
            meaning of the bottom edge is explicit without leaning
            on tooltips. */}
        <text
          x={(STAGE_LEFT + STAGE_RIGHT) / 2}
          y={FEEDBACK_Y + 22}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px] uppercase tracking-[0.2em]"
        >
          feedback loop
        </text>

        {/* Agent tokens -- three of them, staggered, tracing the full
            rectangular loop via SVG animateMotion. Speed is
            intentionally slow (18s) and opacity is held down so the
            tokens read as "ambient agents at work" rather than
            "racing dots demanding attention". The shared path id
            means staggering is purely a `begin` offset, so the
            three tokens stay in sync if dur is retuned. Omitted
            entirely under reduced motion so assistive tech does not
            see "moving" content. */}
        {showAgents && (
          <g aria-hidden opacity="0.7">
            {[0, 0.33, 0.66].map((delay, i) => (
              <circle key={i} r="6" fill={`url(#${tokenGradId})`}>
                {!prefersReducedMotion && (
                  <animateMotion
                    dur="18s"
                    repeatCount="indefinite"
                    rotate="auto"
                    begin={`-${(delay * 18).toFixed(2)}s`}
                  >
                    <mpath href={`#${flowPathId}`} />
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
// Path helpers — kept exported for tests and for future viz modes that
// want to reuse the same pipeline geometry.
// ---------------------------------------------------------------------------

/**
 * The forward pipeline rail as an SVG path: a horizontal line from
 * Specify on the left to Observe on the right at PIPELINE_Y. Used as
 * the first half of the agent token's flow path.
 */
export function describePipelineRail(): string {
  return `M ${STAGE_LEFT} ${PIPELINE_Y} L ${STAGE_RIGHT} ${PIPELINE_Y}`;
}

/**
 * The feedback edge as a rectangular bottom rail with rounded
 * corners. Draws right -> down -> left -> up so it forms three sides
 * of the rectangle complementing the top pipeline rail.
 *
 * Exported under the original name so test code that still imports
 * `describeFeedbackArc` keeps building -- the shape changed (curve
 * -> rect) but the topology (Observe -> ... -> Specify) is the same.
 */
export function describeFeedbackArc(): string {
  return [
    `M ${STAGE_RIGHT} ${PIPELINE_Y}`,
    `Q ${STAGE_RIGHT + CORNER_R} ${PIPELINE_Y}, ${STAGE_RIGHT + CORNER_R} ${PIPELINE_Y + CORNER_R}`,
    `L ${STAGE_RIGHT + CORNER_R} ${FEEDBACK_Y - CORNER_R}`,
    `Q ${STAGE_RIGHT + CORNER_R} ${FEEDBACK_Y}, ${STAGE_RIGHT} ${FEEDBACK_Y}`,
    `L ${STAGE_LEFT} ${FEEDBACK_Y}`,
    `Q ${STAGE_LEFT - CORNER_R} ${FEEDBACK_Y}, ${STAGE_LEFT - CORNER_R} ${FEEDBACK_Y - CORNER_R}`,
    `L ${STAGE_LEFT - CORNER_R} ${PIPELINE_Y + CORNER_R}`,
    `Q ${STAGE_LEFT - CORNER_R} ${PIPELINE_Y}, ${STAGE_LEFT} ${PIPELINE_Y}`,
  ].join(" ");
}

/**
 * Full loop path used by the agent tokens: forward along the top
 * rail (Specify -> Observe), then around the rectangular feedback
 * edge (right corner down, bottom right-to-left, left corner up)
 * and back to Specify. Closed with `Z` so animateMotion wraps
 * cleanly without a visible jump at the seam.
 */
export function describeFullLoop(): string {
  return [
    `M ${STAGE_LEFT} ${PIPELINE_Y}`,
    `L ${STAGE_RIGHT} ${PIPELINE_Y}`,
    `Q ${STAGE_RIGHT + CORNER_R} ${PIPELINE_Y}, ${STAGE_RIGHT + CORNER_R} ${PIPELINE_Y + CORNER_R}`,
    `L ${STAGE_RIGHT + CORNER_R} ${FEEDBACK_Y - CORNER_R}`,
    `Q ${STAGE_RIGHT + CORNER_R} ${FEEDBACK_Y}, ${STAGE_RIGHT} ${FEEDBACK_Y}`,
    `L ${STAGE_LEFT} ${FEEDBACK_Y}`,
    `Q ${STAGE_LEFT - CORNER_R} ${FEEDBACK_Y}, ${STAGE_LEFT - CORNER_R} ${FEEDBACK_Y - CORNER_R}`,
    `L ${STAGE_LEFT - CORNER_R} ${PIPELINE_Y + CORNER_R}`,
    `Q ${STAGE_LEFT - CORNER_R} ${PIPELINE_Y}, ${STAGE_LEFT} ${PIPELINE_Y}`,
    "Z",
  ].join(" ");
}
