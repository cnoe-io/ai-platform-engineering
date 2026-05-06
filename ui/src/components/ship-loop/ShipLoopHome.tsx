"use client";

/**
 * Ship Loop home -- the empty / preview state.
 *
 * Shipped early as a visible demo target for the toggle wiring; the
 * real onboarded-repo grid lands in T039. When that lands, this file
 * either (a) gets replaced by the real grid for users with at least
 * one onboarded repo, or (b) stays as the empty-state illustration
 * for users with zero repos onboarded -- both paths keep
 * ShipLoopAnimation + SwimLanePreview as the visual anchors.
 *
 * Design intent (from user feedback "AI-native, sexy, swim lanes,
 * loops, nice graphics"):
 *   - Atmospheric gradient backdrop in the AG-UI palette.
 *   - Eyebrow chip + gradient-text title -> the feature has a
 *     personality, not just a header.
 *   - ShipLoopAnimation as the hero: the eight-stage loop shown
 *     literally as an animated orbit so users see "what they are
 *     about to onboard into" before they have any data.
 *   - Stage tiles -> the canonical Specify -> Observe vocabulary
 *     surfaced once, with the same icon + color the per-Epic views
 *     will reuse.
 *   - SwimLanePreview -> previews the kanban viz that lands in US2.
 *   - Capabilities grid -> existing copy, restyled with glass-panel
 *     + hover-glow so it feels native to the design system.
 *
 * Everything heavier than CSS animations is gated behind motion-safe
 * via the underlying components.
 *
 * Spec: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md
 */

import {
  GitBranch,
  Workflow,
  MessageSquare,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { RepoGrid } from "@/components/ship-loop/RepoGrid";
import { ShipLoopAnimation } from "@/components/ship-loop/visualizations/ShipLoopAnimation";
import { SwimLanePreview } from "@/components/ship-loop/visualizations/SwimLanePreview";
import {
  ORBIT_STAGES,
  STAGE_VISUALS,
} from "@/components/ship-loop/visualizations/stage-visuals";

export function ShipLoopHome() {
  return (
    <div className="relative flex-1 overflow-y-auto">
      {/* Atmospheric gradient mesh -- two soft radials in the AG-UI
          palette, very low opacity so the rest of the app's chrome
          still wins for contrast. Pointer-events disabled so it
          never intercepts clicks. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, hsl(var(--gradient-start) / 0.45), transparent)",
          }}
        />
        <div
          className="absolute -top-20 right-0 h-[480px] w-[480px] rounded-full opacity-25 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, hsl(var(--gradient-mid) / 0.45), transparent)",
          }}
        />
        <div
          className="absolute top-[260px] left-1/3 h-[420px] w-[420px] rounded-full opacity-20 blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, hsl(var(--gradient-end) / 0.4), transparent)",
          }}
        />
      </div>

      <div className="relative max-w-6xl mx-auto p-6 md:p-8 space-y-8">
        {/* Hero strip */}
        <section className="space-y-4">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border border-primary/30 bg-primary/10 text-primary">
            <Sparkles className="h-3 w-3" aria-hidden />
            <span className="uppercase tracking-wider">Preview</span>
            <span className="text-primary/70">— Agentic SDLC</span>
          </span>

          <div className="space-y-3 max-w-3xl">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight">
              <span className="gradient-text">Engineers write the rules.</span>
              <br />
              <span className="text-foreground">Agents run the ship loop.</span>
            </h1>
            <p className="text-sm md:text-base text-muted-foreground max-w-2xl">
              Onboard a GitHub repo and watch autonomous agents drive an Epic
              from specification through sub-tasks, pull requests, human-in-the-loop
              review, merge, and sandbox deployment — live, label-driven, and
              webhook-fed.
            </p>
          </div>
        </section>

        {/* Hero animation -- the centerpiece. Lives in a glass panel
            so the gradient mesh shows through subtly behind it. */}
        <section className="glass-panel rounded-2xl p-4 md:p-6">
          <ShipLoopAnimation />
        </section>

        {/* Onboarded repos -- the live data surface. Renders an
            empty/error/loading state without blowing up the page so
            the mock-webhook demo always has something to show. */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Onboarded repos
            </h2>
            <span className="text-[11px] text-muted-foreground/70">
              Live counts from the projector
            </span>
          </div>
          <RepoGrid />
        </section>

        {/* Stage tiles -- one per canonical stage, in order. Doubles as
            a legend for the animation above. */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              The eight stages
            </h2>
            <span className="text-[11px] text-muted-foreground/70">
              Specify → Observe → back to spec
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {ORBIT_STAGES.map((stage) => {
              const visual = STAGE_VISUALS[stage];
              const Icon = visual.icon;
              return (
                <div
                  key={stage}
                  className={[
                    "rounded-lg border px-2.5 py-2 transition-shadow hover-glow",
                    visual.bgClass,
                    visual.borderClass,
                  ].join(" ")}
                  title={visual.blurb}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon
                      className={["h-3.5 w-3.5", visual.fgClass].join(" ")}
                      aria-hidden
                    />
                    <span className="text-[11px] font-semibold tracking-tight text-foreground">
                      {visual.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground/80 leading-tight">
                    {visual.blurb}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Swim-lane preview -- shows the kanban viz coming in US2. */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              In flight
            </h2>
            <span className="text-[11px] text-muted-foreground/70">
              Mock data — the real lanes light up once you onboard a repo
            </span>
          </div>
          <SwimLanePreview />
        </section>

        {/* Capabilities -- existing copy, restyled with glass + hover glow.
            Each card now leads with a colored stage-style icon plate so it
            visually links back to the stage tiles above. */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            What ships next
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <CapabilityCard
              icon={GitBranch}
              accent="text-violet-400"
              accentBg="bg-violet-500/10"
              accentBorder="border-violet-500/30"
              title="Onboard a repo"
              body="Connect any GitHub repository you have access to. We register a webhook scoped to exactly the events the Ship Loop needs."
              footnote="Lands in US1 (T030–T043)"
            />
            <CapabilityCard
              icon={Workflow}
              accent="text-sky-400"
              accentBg="bg-sky-500/10"
              accentBorder="border-sky-500/30"
              title="Visualize an Epic"
              body="Switch among Pipeline, Kanban, Timeline, Dependency Graph, and Ship-Loop Radar — all driven from the same event log."
              footnote="Lands in US2 (T044–T058) and US4 (T067–T070)"
            />
            <CapabilityCard
              icon={MessageSquare}
              accent="text-amber-400"
              accentBg="bg-amber-500/10"
              accentBorder="border-amber-500/30"
              title="Stay in the loop"
              body="Approve, request changes, comment, or retry deploys inline. Talk to a read-only agent assistant scoped to the active Epic."
              footnote="Lands in US5 (T071–T083)"
            />
          </div>
        </section>

        {/* Demoted preview note -- still useful info but no longer the
            loudest thing on the page. */}
        <section className="text-[11px] text-muted-foreground/70 flex items-center gap-1.5 pt-2 border-t border-border/40">
          <ArrowRight className="h-3 w-3" aria-hidden />
          <span>
            Track delivery in{" "}
            <code className="px-1 py-0.5 rounded bg-muted/40 text-[10px]">
              docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/tasks.md
            </code>
          </span>
        </section>
      </div>
    </div>
  );
}

interface CapabilityCardProps {
  icon: typeof GitBranch;
  accent: string;
  accentBg: string;
  accentBorder: string;
  title: string;
  body: string;
  footnote: string;
}

function CapabilityCard({
  icon: Icon,
  accent,
  accentBg,
  accentBorder,
  title,
  body,
  footnote,
}: CapabilityCardProps) {
  return (
    <div className="glass-panel rounded-xl p-4 space-y-2.5 hover-glow transition-shadow">
      <div className="flex items-center gap-2">
        <span
          className={[
            "h-7 w-7 rounded-md border flex items-center justify-center",
            accentBg,
            accentBorder,
          ].join(" ")}
        >
          <Icon className={["h-3.5 w-3.5", accent].join(" ")} aria-hidden />
        </span>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
        {footnote}
      </p>
    </div>
  );
}
