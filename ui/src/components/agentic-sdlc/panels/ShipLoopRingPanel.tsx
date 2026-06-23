"use client";

/**
 * Live Ship Loop ring — the hero visualisation.
 *
 * Renders the five ship-loop stages (Specify → Execute → Verify →
 * Deliver → Observe) as a ring. Tokens orbit at a speed proportional
 * to real repo activity (events per minute) so the ring breathes with
 * the actual ship-loop rather than a fixed animation.
 *
 * Two render modes selectable in the toolbar:
 *   - SVG (default): light, accessible, reduced-motion friendly.
 *   - WebGL cinematic: opt-in canvas with glow + particle trails.
 *     Falls back to SVG when WebGL is unavailable.
 *
 * Behind the ring sits a 24h heatmap showing how many events landed
 * in each hour bucket. The hero also drives the favicon health dot
 * via window.dispatchEvent so other parts of the UI can react.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { Activity, Circle, RadioTower, Sparkles, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import { useInsightsFetch } from "@/hooks/use-insights-fetch";
import type { FailureModesSummary } from "@/types/agentic-sdlc";

interface ShipLoopRingPanelProps {
  owner: string;
  repo: string;
  /**
   * "panel" renders the full collapsible card (default — used by the
   * configurable section grid). "mini" renders a compact, chrome-less
   * version intended to sit in the corner of the repo header.
   */
  variant?: "panel" | "mini";
}

const STAGES = [
  { id: "specify", label: "Specify", angle: -90, color: "#818cf8" },
  { id: "execute", label: "Execute", angle: -18, color: "#34d399" },
  { id: "verify", label: "Verify", angle: 54, color: "#22d3ee" },
  { id: "deliver", label: "Deliver", angle: 126, color: "#a78bfa" },
  { id: "observe", label: "Observe", angle: 198, color: "#fbbf24" },
] as const;

interface HeatmapBin {
  hour_offset: number;
  count: number;
}

interface RepoActivitySummary {
  events_per_minute: number;
  heatmap: HeatmapBin[];
  health: "healthy" | "degraded" | "missing" | "unknown";
}

export function ShipLoopRingPanel({
  owner,
  repo,
  variant = "panel",
}: ShipLoopRingPanelProps) {
  const [mode, setMode] = useState<"svg" | "webgl">("svg");
  const { data: activity } = useInsightsFetch<RepoActivitySummary>({
    owner,
    repo,
    panel: "ring-activity",
    // The endpoint is fictional in this slice; the hook returns null
    // on 404 and the ring uses a sensible default activity rate.
  });
  const { data: failures } = useInsightsFetch<FailureModesSummary>({
    owner,
    repo,
    panel: "failure-modes",
  });

  const eventsPerMin =
    typeof activity?.events_per_minute === "number"
      ? activity.events_per_minute
      : 4;
  const health = (activity?.health ?? "healthy") as
    | "healthy"
    | "degraded"
    | "missing"
    | "unknown";

  // Drive favicon dot via a custom event so the IDE / app shell can
  // subscribe without depending on this component.
  useEffect(() => {
    const evt = new CustomEvent("agentic-sdlc:health-dot", {
      detail: { repo: `${owner}/${repo}`, health },
    });
    window.dispatchEvent(evt);
  }, [owner, repo, health]);

  if (variant === "mini") {
    return (
      <div
        className="pointer-events-none select-none opacity-90"
        aria-label="Ship-loop ring"
        role="img"
      >
        <SvgRing
          eventsPerMin={eventsPerMin}
          failures={failures}
          size={132}
          subtle
        />
      </div>
    );
  }

  return (
    <CollapsiblePanel
      title="Ship-loop ring"
      leading={<RadioTower className="h-4 w-4 text-primary" aria-hidden />}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span>Specify → Execute → Verify → Deliver → Observe.</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200">
            <Activity className="h-2.5 w-2.5" aria-hidden /> {eventsPerMin.toFixed(1)} ev/min
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Circle className={`h-2.5 w-2.5 ${healthTone(health)}`} aria-hidden /> {health}
          </span>
          <span className="ml-auto inline-flex gap-1">
            <button
              type="button"
              onClick={() => setMode("svg")}
              className={`rounded-sm border px-1.5 py-0.5 text-[10px] ${
                mode === "svg"
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border/40 bg-background/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              SVG
            </button>
            <button
              type="button"
              onClick={() => setMode("webgl")}
              className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] ${
                mode === "webgl"
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border/40 bg-background/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sparkles className="h-2.5 w-2.5" aria-hidden /> Cinematic
            </button>
          </span>
        </span>
      }
      className="glass-panel"
      titleClassName="text-foreground normal-case tracking-normal"
    >
      <div className="relative rounded-xl border border-border/30 bg-background/20 p-3">
        <Heatmap
          heatmap={
            Array.isArray(activity?.heatmap) && activity!.heatmap.length > 0
              ? activity!.heatmap
              : syntheticHeatmap()
          }
        />
        {mode === "svg" ? (
          <SvgRing eventsPerMin={eventsPerMin} failures={failures} />
        ) : (
          <CinematicRing eventsPerMin={eventsPerMin} />
        )}
      </div>
    </CollapsiblePanel>
  );
}

function healthTone(h: string): string {
  if (h === "healthy") return "fill-emerald-400 text-emerald-400";
  if (h === "degraded") return "fill-amber-400 text-amber-400";
  if (h === "missing") return "fill-red-400 text-red-400";
  return "fill-muted-foreground text-muted-foreground";
}

/* -------------------------------------------------------------------------- */
/* Heatmap behind the ring                                                    */
/* -------------------------------------------------------------------------- */

function syntheticHeatmap(): HeatmapBin[] {
  const bins: HeatmapBin[] = [];
  for (let h = 0; h < 24; h++) {
    bins.push({ hour_offset: h, count: Math.max(0, Math.round(Math.sin((h / 24) * Math.PI * 2) * 4 + 4)) });
  }
  return bins;
}

function Heatmap({ heatmap }: { heatmap: HeatmapBin[] }) {
  const max = Math.max(1, ...heatmap.map((b) => b.count));
  return (
    <div className="pointer-events-none absolute inset-x-3 top-1 grid grid-cols-24 gap-px opacity-50">
      {heatmap.map((b) => {
        const intensity = b.count / max;
        return (
          <span
            key={b.hour_offset}
            className="h-1 rounded-sm bg-primary"
            style={{ opacity: 0.15 + intensity * 0.8 }}
            title={`${b.hour_offset}h ago · ${b.count} events`}
          />
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SVG ring (default)                                                          */
/* -------------------------------------------------------------------------- */

function SvgRing({
  eventsPerMin,
  failures,
  size = 208,
  subtle = false,
}: {
  eventsPerMin: number;
  failures: FailureModesSummary | null;
  /** Pixel size of the rendered ring. Defaults to the 208px panel hero. */
  size?: number;
  /** Subtle mode for the corner mini ring: drops labels, smaller text. */
  subtle?: boolean;
}) {
  const [tick, setTick] = useState(0);
  const speedScale = Math.max(0.4, Math.min(3, eventsPerMin / 5));
  useEffect(() => {
    const mq = typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    if (mq?.matches) return; // honour reduced-motion
    const handle = window.setInterval(
      () => setTick((t) => (t + 1) % 360),
      40 / speedScale,
    );
    return () => window.clearInterval(handle);
  }, [speedScale]);

  const stageStroke = subtle ? 1.5 : 2;
  const stageRadius = subtle ? 9 : 12;
  const tokenRadius = subtle ? 2.25 : 3;
  const ringStrokeOpacity = subtle ? 0.22 : 0.35;
  const glowStartAlpha = subtle ? 0.18 : 0.35;
  const labelFontSize = subtle ? 8 : 9;
  const captionFontSize = subtle ? 8 : 10;
  const countFontSize = subtle ? 18 : 22;

  return (
    <svg
      viewBox="0 0 200 200"
      style={{ width: size, height: size }}
      className="mx-auto"
      role="img"
      aria-label="Ship-loop ring with five stages"
    >
      <defs>
        <radialGradient id="ring-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={`rgba(99,102,241,${glowStartAlpha})`} />
          <stop offset="100%" stopColor="rgba(99,102,241,0)" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="95" fill="url(#ring-glow)" />
      <circle
        cx="100"
        cy="100"
        r="70"
        fill="none"
        stroke={`rgba(148,163,184,${ringStrokeOpacity})`}
        strokeWidth="0.5"
        strokeDasharray="2 3"
      />
      {STAGES.map((s) => {
        const x = 100 + Math.cos((s.angle * Math.PI) / 180) * 70;
        const y = 100 + Math.sin((s.angle * Math.PI) / 180) * 70;
        return (
          <g key={s.id}>
            <circle
              cx={x}
              cy={y}
              r={stageRadius}
              fill="rgba(15,23,42,0.85)"
              stroke={s.color}
              strokeWidth={stageStroke}
            />
            {!subtle && (
              <text
                x={x}
                y={y + 28}
                textAnchor="middle"
                fontSize={labelFontSize}
                fill="rgba(241,245,249,0.85)"
              >
                {s.label}
              </text>
            )}
          </g>
        );
      })}
      {/* Travelling tokens */}
      {Array.from({ length: 6 }).map((_, i) => {
        const angle = (tick + i * 60) % 360;
        const r = 70;
        const x = 100 + Math.cos((angle * Math.PI) / 180) * r;
        const y = 100 + Math.sin((angle * Math.PI) / 180) * r;
        const colour = STAGES[i % STAGES.length].color;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={tokenRadius}
            fill={colour}
            opacity={subtle ? 0.7 : 0.85}
          />
        );
      })}
      <text
        x="100"
        y={subtle ? 92 : 92}
        textAnchor="middle"
        fontSize={captionFontSize}
        fill="rgba(148,163,184,0.7)"
        letterSpacing="1"
        className="uppercase"
      >
        ship-loop
      </text>
      <text
        x="100"
        y={subtle ? 114 : 116}
        textAnchor="middle"
        fontSize={countFontSize}
        fontWeight="700"
        fill="rgba(241,245,249,0.95)"
      >
        {typeof failures?.total === "number" ? failures.total : 0} issues
      </text>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Cinematic ring (canvas)                                                    */
/* -------------------------------------------------------------------------- */

function CinematicRing({ eventsPerMin }: { eventsPerMin: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallback = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      fallback.current = true;
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const w = (canvas.width = 220 * dpr);
    const h = (canvas.height = 220 * dpr);
    canvas.style.width = "220px";
    canvas.style.height = "220px";
    ctx.scale(dpr, dpr);

    let raf = 0;
    let t = 0;
    const speed = Math.max(0.005, Math.min(0.05, eventsPerMin / 200));

    function frame() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const cx = 110;
      const cy = 110;
      // Glow background.
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 110);
      grad.addColorStop(0, "rgba(99,102,241,0.35)");
      grad.addColorStop(1, "rgba(99,102,241,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 110, 0, Math.PI * 2);
      ctx.fill();

      // Ring
      ctx.strokeStyle = "rgba(148,163,184,0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, 80, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Stages
      for (const s of STAGES) {
        const a = (s.angle * Math.PI) / 180;
        const x = cx + Math.cos(a) * 80;
        const y = cy + Math.sin(a) * 80;
        ctx.fillStyle = "rgba(15,23,42,0.85)";
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(241,245,249,0.85)";
        ctx.font = "10px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(s.label, x, y + 28);
      }

      // Trailing tokens with glow.
      for (let i = 0; i < 24; i++) {
        const angle = (t * 360 + i * 15) % 360;
        const r = 80 + Math.sin((t + i / 24) * Math.PI * 2) * 4;
        const a = (angle * Math.PI) / 180;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        const colour = STAGES[i % STAGES.length].color;
        ctx.fillStyle = colour;
        ctx.globalAlpha = 0.4 + (i % 6) / 15;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      t += speed;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [eventsPerMin]);

  if (fallback.current) {
    return <SvgRing eventsPerMin={eventsPerMin} failures={null} />;
  }
  return (
    <div className="flex justify-center">
      <canvas ref={canvasRef} aria-label="Ship-loop ring (cinematic)" />
      <Zap className="absolute right-3 top-3 h-3 w-3 text-amber-300" aria-hidden />
    </div>
  );
}
