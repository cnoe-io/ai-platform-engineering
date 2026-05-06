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
        {/* Hero -- two-column on md+. Copy + an inline stage-icon
            row on the left, the animation on the right with NO
            glass panel so it floats freely against the page's
            ambient gradient mesh (the previous opaque rectangle
            visually fenced the orbit off and made it look like a
            placeholder). */}
        <section className="grid gap-6 md:grid-cols-12 md:items-center">
          <div className="space-y-5 md:col-span-6">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border border-primary/30 bg-primary/10 text-primary">
              <Sparkles className="h-3 w-3" aria-hidden />
              <span className="uppercase tracking-wider">Preview</span>
              <span className="text-primary/70">— Agentic SDLC</span>
            </span>

            <div className="space-y-3">
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight">
                <span className="gradient-text">Engineers write the rules.</span>
                <br />
                <span className="text-foreground">Agents run the ship loop.</span>
              </h1>
              <p className="text-sm md:text-base text-muted-foreground max-w-xl">
                Onboard a GitHub repo and watch autonomous agents drive an Epic
                from specification through sub-tasks, pull requests, human-in-the-loop
                review, merge, and sandbox deployment — live, label-driven, and
                webhook-fed.
              </p>
            </div>

            {/* Inline stage rail -- gives the headline an immediate
                visual anchor in the AI-native palette without
                duplicating the full legend tiles below. Each pill
                tints itself with the same per-stage color tokens the
                animation and per-Epic views use, so the colors are a
                contract, not decoration. */}
            <ul
              className="flex flex-wrap items-center gap-1.5 pt-1"
              aria-label="Ship-loop stages"
            >
              {ORBIT_STAGES.map((stage, idx) => {
                const visual = STAGE_VISUALS[stage];
                const Icon = visual.icon;
                return (
                  <li key={stage} className="flex items-center gap-1.5">
                    <span
                      className={[
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        visual.bgClass,
                        visual.borderClass,
                      ].join(" ")}
                      title={visual.blurb}
                    >
                      <Icon
                        className={["h-3 w-3", visual.fgClass].join(" ")}
                        aria-hidden
                      />
                      <span className="text-foreground/90">{visual.label}</span>
                    </span>
                    {idx < ORBIT_STAGES.length - 1 ? (
                      <span
                        aria-hidden
                        className="text-muted-foreground/40 text-[10px]"
                      >
                        →
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="md:col-span-6">
            <div className="mx-auto md:ml-auto md:mr-0 max-w-[640px]">
              <ShipLoopAnimation />
            </div>
          </div>
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

        {/* Stage legend -- richer per-stage blurbs (the inline rail
            in the hero only shows label + icon). Acts as a glossary
            tying the animation, the inline rail, and the eventual
            per-Epic views to one shared vocabulary. */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Stage glossary
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
