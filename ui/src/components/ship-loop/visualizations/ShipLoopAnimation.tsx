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
// driven by viewBox + responsive width on the wrapper. Tuned so that:
//   - Stage spacing accommodates the longest label ("Implement") at
//     12px text without crowding its neighbours.
//   - The feedback arc has enough vertical headroom (FEEDBACK_DROP)
//     that its curve reads as a deliberate U-turn rather than a
//     near-straight line, even on small renders.
const VIEWBOX_W = 880;
const VIEWBOX_H = 280;
const PIPELINE_Y = 110; // Y of the main pipeline rail.
const STAGE_LEFT = 60;
const STAGE_RIGHT = VIEWBOX_W - 60;
const FEEDBACK_DROP = 110; // how far below the pipeline the feedback arc dips.

/** Pipeline position (0..1) -> SVG coordinates on the horizontal rail. */
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

          {/* Hidden full-loop path the agent tokens follow:
              forward along the pipeline, U-turn at Observe, back
              along the feedback arc, U-turn at Specify, repeat. */}
          <path id={flowPathId} d={describeFullLoop()} fill="none" />
        </defs>

        {/* Pipeline rail -- the spine of the diagram. */}
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

        {/* Direction arrowhead on the right end so the pipeline reads
            as flowing forward, not just a static bar. */}
        <path
          d={`M ${STAGE_RIGHT} ${PIPELINE_Y} l -10 -6 l 0 12 z`}
          fill="hsl(var(--gradient-end))"
          opacity="0.9"
        />

        {/* Feedback arc -- Observe back to Specify, dipping below the
            pipeline. The curve has enough vertical drop (FEEDBACK_DROP)
            that the U-turn reads clearly. */}
        <path
          d={describeFeedbackArc()}
          fill="none"
          stroke={`url(#${trackGradId})`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="6 8"
          opacity="0.45"
        />

        {/* Animated dash flow on the feedback arc so "observed reality
            feeds the next spec" is visible at a glance. Gated behind
            motion-safe so reduced-motion users see only the static
            dashed line. */}
        <path
          d={describeFeedbackArc()}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="2 14"
          opacity="0.7"
          className="motion-safe:animate-ship-loop-dash"
        />

        {/* Stage nodes -- each rendered as the canonical Lucide icon
            for that stage, on a colored disc, so the visual is the
            same vocabulary the inline rail and per-Epic views use.
            The icon SVG is positioned via x/y on the Lucide element
            itself (Lucide icons accept SVG-standard positioning). */}
        {stageNodes.map(({ stage, visual, x, y }, i) => {
          const Icon = visual.icon;
          return (
            <g key={stage} transform={`translate(${x} ${y})`}>
              {/* Halo -- pulses to suggest live activity. */}
              <circle
                r="22"
                fill={`hsl(${visual.hsl} / 0.18)`}
                className="motion-safe:animate-ship-loop-halo origin-center"
                style={{ animationDelay: `${(i * 0.15).toFixed(2)}s` }}
              />
              {/* Disc backdrop -- gives the icon a solid plate so it
                  reads against the page's gradient mesh. The disc
                  uses the stage's HSL token at high opacity, the
                  icon strokes white so it's legible on every disc. */}
              <circle
                r="14"
                fill={`hsl(${visual.hsl})`}
                filter={`url(#${glowFilterId})`}
              />
              {/* Lucide icon. The component renders an <svg> root;
                  nesting <svg> inside <svg> is valid SVG2 and is
                  positioned via x/y on the inner svg element. We
                  also lock width/height so the icon scales with the
                  parent viewBox rather than its intrinsic 24px. */}
              <Icon
                x={-9}
                y={-9}
                width={18}
                height={18}
                strokeWidth={2.25}
                color="white"
                aria-hidden
              />
              {/* Alternate label position above/below to avoid the
                  neighbours crashing into each other on narrow
                  renders. Even-indexed stages go above, odd-indexed
                  below. */}
              <text
                y={i % 2 === 0 ? -32 : 38}
                textAnchor="middle"
                className="fill-foreground text-[12px] font-semibold tracking-tight"
              >
                {visual.label}
              </text>
              {/* Stage blurb on the bookends only, so the eye knows
                  where the loop starts and where it observes. */}
              {(stage === "specify" || stage === "observe") && (
                <text
                  y={i % 2 === 0 ? -48 : 54}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {visual.blurb}
                </text>
              )}
            </g>
          );
        })}

        {/* Loop label tucked under the feedback arc so the meaning of
            the lower curve is explicit without leaning on tooltips. */}
        <text
          x={(STAGE_LEFT + STAGE_RIGHT) / 2}
          y={PIPELINE_Y + FEEDBACK_DROP + 24}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px] uppercase tracking-[0.2em]"
        >
          feedback loop
        </text>

        {/* Agent tokens -- three of them, staggered, tracing the full
            forward + feedback path via SVG animateMotion. The shared
            path id means the staggering is purely a `begin` offset,
            so all three tokens stay in sync if the dur is retuned.
            Omitted entirely under reduced motion so assistive tech
            does not see "moving" content. */}
        {showAgents && (
          <g aria-hidden>
            {[0, 0.33, 0.66].map((delay, i) => (
              <circle key={i} r="8" fill={`url(#${tokenGradId})`}>
                {!prefersReducedMotion && (
                  <animateMotion
                    dur="11s"
                    repeatCount="indefinite"
                    rotate="auto"
                    begin={`-${(delay * 11).toFixed(2)}s`}
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
 * The feedback arc -- a smooth U-shaped Bezier from Observe back to
 * Specify, dipping FEEDBACK_DROP units below the pipeline. The curve
 * is symmetric around the pipeline midpoint so the dip reads as
 * intentional rather than skewed.
 */
export function describeFeedbackArc(): string {
  const startX = STAGE_RIGHT;
  const endX = STAGE_LEFT;
  const dipY = PIPELINE_Y + FEEDBACK_DROP;
  // Cubic bezier with both control points at dipY; this gives the
  // arc its symmetric U-shape regardless of the horizontal span.
  return `M ${startX} ${PIPELINE_Y} C ${startX} ${dipY}, ${endX} ${dipY}, ${endX} ${PIPELINE_Y}`;
}

/**
 * Full loop path used by the agent tokens: forward along the pipeline
 * (Specify -> Observe) then back along the feedback arc (Observe ->
 * Specify). Closed with `Z` so the animation wraps cleanly without a
 * visible jump at the seam.
 */
export function describeFullLoop(): string {
  return [
    describePipelineRail(),
    // The feedback arc starts at STAGE_RIGHT/PIPELINE_Y (where the
    // pipeline ended) so we can chain it directly without an
    // intermediate "M".
    `C ${STAGE_RIGHT} ${PIPELINE_Y + FEEDBACK_DROP}, ${STAGE_LEFT} ${
      PIPELINE_Y + FEEDBACK_DROP
    }, ${STAGE_LEFT} ${PIPELINE_Y}`,
    "Z",
  ].join(" ");
}
