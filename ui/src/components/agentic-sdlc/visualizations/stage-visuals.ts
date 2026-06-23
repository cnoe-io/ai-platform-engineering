/**
 * Shared visual vocabulary for ship-loop stages.
 *
 * Every visualization mode (Pipeline, Kanban, Timeline, Dependency
 * graph, Ship-loop radar, plus the home-page hero) reads its icon,
 * accent color, and gradient stops from this single map. That keeps
 * the same Epic looking like the same Epic across modes and prevents
 * a five-mode ramp from drifting into five different palettes.
 *
 * Colors are expressed as HSL triples ("H S% L%") so they can be
 * dropped into the codebase's existing `hsl(var(--...))` pattern, and
 * also as Tailwind classes for components that prefer utility classes.
 *
 * Anchored to: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui
 *   - Spec stages: specify -> plan -> tasks -> implement -> unit_test
 *                 -> review_hitl -> merge -> deploy -> validate -> observe
 *   - Plus terminal stages: blocked, unknown
 */

import type { AgenticSdlcStage } from "@/types/agentic-sdlc";
import {
  Sparkles,
  ListTodo,
  Layers,
  Code2,
  FlaskConical,
  ShieldCheck,
  GitMerge,
  Rocket,
  Activity,
  AlertOctagon,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

export interface StageVisual {
  /** Human-readable label shown to users. */
  label: string;
  /** One-line description used in tooltips and the stage tiles. */
  blurb: string;
  /** lucide-react icon component. */
  icon: LucideIcon;
  /** HSL triple, e.g. "199 89% 48%". Plug into hsl(...). */
  hsl: string;
  /** Tailwind classes for foreground (text + icon). */
  fgClass: string;
  /** Tailwind classes for the soft tile background. */
  bgClass: string;
  /** Tailwind classes for the tile border. */
  borderClass: string;
  /** Position 0..1 along the orbit / pipeline (specify = 0, observe = 1). */
  orbitPos: number;
}

/**
 * Color choices intentionally reuse the existing a2a-* palette where
 * the meaning matches (task = blue, status = green, tool = amber,
 * artifact = purple) so badges and tiles already in the app feel
 * native to the Agentic SDLC.
 */
export const STAGE_VISUALS: Record<AgenticSdlcStage, StageVisual> = {
  specify: {
    label: "Specify",
    blurb: "Humans write the rules",
    icon: Sparkles,
    hsl: "270 75% 60%",
    fgClass: "text-purple-400",
    bgClass: "bg-purple-500/10",
    borderClass: "border-purple-500/30",
    orbitPos: 0 / 9,
  },
  plan: {
    label: "Plan",
    blurb: "Agent breaks intent into work",
    icon: Layers,
    hsl: "262 83% 70%",
    fgClass: "text-violet-400",
    bgClass: "bg-violet-500/10",
    borderClass: "border-violet-500/30",
    orbitPos: 1 / 9,
  },
  tasks: {
    label: "Tasks",
    blurb: "Sub-issues fan out",
    icon: ListTodo,
    hsl: "217 91% 60%",
    fgClass: "text-blue-400",
    bgClass: "bg-blue-500/10",
    borderClass: "border-blue-500/30",
    orbitPos: 2 / 9,
  },
  implement: {
    label: "Implement",
    blurb: "Agent writes the code",
    icon: Code2,
    hsl: "199 89% 48%",
    fgClass: "text-sky-400",
    bgClass: "bg-sky-500/10",
    borderClass: "border-sky-500/30",
    orbitPos: 3 / 9,
  },
  unit_test: {
    label: "Unit Test",
    blurb: "Fast checks prove the code",
    icon: FlaskConical,
    hsl: "188 86% 53%",
    fgClass: "text-cyan-300",
    bgClass: "bg-cyan-500/10",
    borderClass: "border-cyan-500/30",
    orbitPos: 4 / 9,
  },
  review_hitl: {
    label: "Review",
    blurb: "Human-in-the-loop approval",
    icon: ShieldCheck,
    hsl: "38 92% 50%",
    fgClass: "text-amber-400",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/30",
    orbitPos: 5 / 9,
  },
  merge: {
    label: "Merge",
    blurb: "Code lands on the trunk",
    icon: GitMerge,
    hsl: "173 80% 45%",
    fgClass: "text-teal-400",
    bgClass: "bg-teal-500/10",
    borderClass: "border-teal-500/30",
    orbitPos: 6 / 9,
  },
  deploy: {
    label: "Deploy",
    blurb: "Sandbox EKS rollout",
    icon: Rocket,
    hsl: "142 71% 45%",
    fgClass: "text-emerald-400",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/30",
    orbitPos: 7 / 9,
  },
  validate: {
    label: "Validate",
    blurb: "E2E checks prove the rollout",
    icon: ShieldCheck,
    hsl: "160 84% 39%",
    fgClass: "text-emerald-300",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/30",
    orbitPos: 8 / 9,
  },
  observe: {
    label: "Observe",
    blurb: "Health, traces, feedback",
    icon: Activity,
    hsl: "172 66% 50%",
    fgClass: "text-cyan-400",
    bgClass: "bg-cyan-500/10",
    borderClass: "border-cyan-500/30",
    orbitPos: 9 / 9,
  },
  blocked: {
    label: "Blocked",
    blurb: "Stalled — needs a human",
    icon: AlertOctagon,
    hsl: "0 72% 51%",
    fgClass: "text-red-400",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/30",
    // Off-orbit by convention — handled separately in viz code.
    orbitPos: -1,
  },
  unknown: {
    label: "Unknown",
    blurb: "No stage signal yet",
    icon: HelpCircle,
    hsl: "215 20% 55%",
    fgClass: "text-muted-foreground",
    bgClass: "bg-muted/40",
    borderClass: "border-border/40",
    orbitPos: -1,
  },
};

/**
 * Stages that participate in the canonical loop (i.e. have a position
 * on the orbit / pipeline). Order matters — visualizations iterate
 * this array left-to-right.
 */
export const ORBIT_STAGES: AgenticSdlcStage[] = [
  "specify",
  "plan",
  "tasks",
  "implement",
  "unit_test",
  "review_hitl",
  "merge",
  "deploy",
  "validate",
  "observe",
];

/** Tailwind classes for text using the product gradient (teal -> purple -> magenta). */
export const AGENTIC_SDLC_GRADIENT_TEXT = "gradient-text";

/** CSS gradient string usable in inline `background:` or fill attributes. */
export const AGENTIC_SDLC_GRADIENT_CSS =
  "linear-gradient(90deg, hsl(var(--gradient-start)), hsl(var(--gradient-mid)), hsl(var(--gradient-end)))";
