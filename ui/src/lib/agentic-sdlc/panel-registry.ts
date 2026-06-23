/**
 * Panel registry for the Agentic SDLC UI.
 *
 * Every panel that can be shown in the Repo Detail or Home surface is
 * declared here as a single descriptor. The registry is the single
 * source of truth that drives:
 *
 *   - the PanelChooser pill bar (what the user can toggle),
 *   - the SectionRenderer (which panel appears in which section),
 *   - the default visibility for new users,
 *   - the default order within a section,
 *   - per-panel categorisation against the ship-loop stages
 *     (specify | execute | verify | deliver | observe | core), which
 *     drives the pill colour, the search filters in the chooser, and
 *     the "category drawer" grouping in the layout dialog.
 *
 * The registry is intentionally a flat array so adding a new panel is
 * one entry: pick its id, section, default visibility, default order
 * within the section, and size hint. The matching React component is
 * wired through `panel-components.tsx` so this module stays free of
 * client/server boundaries.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

// All panel ids that can appear in any surface.
export type PanelId =
  | "ship_loop_ring"
  | "swim_lanes"
  | "epics"
  | "operating_metrics"
  | "spec_health"
  | "intent_drift"
  | "spec_kit_replay"
  | "agent_roster"
  | "mistake_encoded"
  | "agent_budget"
  | "parallel_fanout"
  | "harness"
  | "ci_in_flight"
  | "verifier_confidence"
  | "quality_gauntlet"
  | "failure_modes"
  | "deploy_health"
  | "provenance_sbom"
  | "blast_radius"
  | "rollback_rehearsal"
  | "prod_signal_wire"
  | "pr_prod_sparkline"
  | "changelog"
  | "snapshots"
  | "blackbox_audit"
  | "event_feed";

// Logical sections. Sections render as a row on the page. Within a
// section, half-size panels live in a 2-column grid at xl. Full-size
// panels span the row.
export type PanelSection =
  | "hero"
  | "agents"
  | "epics"
  | "harness"
  | "verify"
  | "execute"
  | "deliver"
  | "deliver_detail"
  | "observe"
  | "context"
  | "footer";

// Categorises the panel against the ship-loop stage it most belongs
// to. Drives pill colour + grouping in the chooser.
export type PanelCategory =
  | "specify"
  | "execute"
  | "verify"
  | "deliver"
  | "observe"
  | "core";

// Surfaces the panel can appear on.
export type PanelSurface = "repo_detail" | "home";

export interface PanelDescriptor {
  id: PanelId;
  title: string;
  // One-line description, used as accessible description on chooser
  // pills and the tooltip in the layout drawer. Keep short.
  description: string;
  section: PanelSection;
  category: PanelCategory;
  // Half or full width inside its section's responsive grid.
  size: "half" | "full";
  // Default visibility per surface. Surfaces not listed here mean the
  // panel cannot appear on that surface at all.
  defaults: Partial<Record<PanelSurface, { visible: boolean; order: number }>>;
  // Tag indicating data backing status. "live" means real data flows;
  // "mock" means the panel renders mocked data with a small badge
  // until the upstream signal is wired. "hybrid" means it shows live
  // data where available and falls back to mock otherwise.
  data: "live" | "mock" | "hybrid";
}

const D = (visible: boolean, order: number) => ({ visible, order });

/**
 * The registry. Keep entries sorted by ship-loop stage so the file
 * reads like the post's narrative: Specify → Execute → Verify →
 * Deliver → Observe.
 */
export const PANEL_REGISTRY: readonly PanelDescriptor[] = [
  // ─────────────────────────────────────────────────────────────────
  // CORE
  // ─────────────────────────────────────────────────────────────────
  {
    id: "ship_loop_ring",
    title: "Ship-loop ring",
    description:
      "Live visualisation of the five-stage agentic SDLC loop driven by real repo activity.",
    section: "hero",
    category: "core",
    size: "full",
    defaults: {
      repo_detail: D(true, 0),
      home: D(true, 0),
    },
    data: "hybrid",
  },
  {
    id: "swim_lanes",
    title: "Agents in action",
    description:
      "Per-stage swim lanes showing the current workload owned by each agent role.",
    section: "agents",
    category: "execute",
    size: "full",
    defaults: { repo_detail: D(true, 0) },
    data: "live",
  },
  {
    id: "epics",
    title: "Epics",
    description: "Drill into active loops and repo-level Epics.",
    section: "epics",
    category: "specify",
    size: "half",
    defaults: { repo_detail: D(true, 0) },
    data: "live",
  },
  {
    id: "operating_metrics",
    title: "Operating metrics",
    description: "Open epics, review pressure, deploy signal, webhook health.",
    section: "epics",
    category: "core",
    size: "half",
    defaults: { repo_detail: D(true, 1) },
    data: "live",
  },

  // ─────────────────────────────────────────────────────────────────
  // SPECIFY
  // ─────────────────────────────────────────────────────────────────
  {
    id: "spec_health",
    title: "Spec health",
    description:
      "Score each epic on whether its spec is agent-ready: AC, NFR, constraints, tests, budget.",
    section: "harness",
    category: "specify",
    size: "half",
    defaults: {
      repo_detail: D(true, 0),
      home: D(true, 2),
    },
    data: "hybrid",
  },
  {
    id: "intent_drift",
    title: "Intent drift",
    description:
      "Delta between the spec's acceptance criteria and the actual PR contents per epic.",
    section: "epics",
    category: "specify",
    size: "full",
    defaults: { repo_detail: D(false, 2) },
    data: "hybrid",
  },
  {
    id: "spec_kit_replay",
    title: "Spec-Kit replay",
    description:
      "Scrub the specify → plan → tasks → implement phases for an epic.",
    section: "footer",
    category: "specify",
    size: "full",
    defaults: { repo_detail: D(false, 0) },
    data: "mock",
  },

  // ─────────────────────────────────────────────────────────────────
  // EXECUTE
  // ─────────────────────────────────────────────────────────────────
  {
    id: "agent_roster",
    title: "Agent roster",
    description: "Live heartbeats and current task for every running agent.",
    section: "execute",
    category: "execute",
    size: "half",
    defaults: { repo_detail: D(false, 0) },
    data: "hybrid",
  },
  {
    id: "agent_budget",
    title: "Agent budget",
    description:
      "LLM tokens (M) burn vs estimate per epic — builder compute and reviewer/verifier traffic. Budget-based planning.",
    section: "execute",
    category: "execute",
    size: "half",
    defaults: { repo_detail: D(false, 1) },
    data: "mock",
  },
  {
    id: "parallel_fanout",
    title: "Parallel fan-out",
    description:
      "Visualises parallel agents working on one epic and where their branches converge.",
    section: "execute",
    category: "execute",
    size: "full",
    defaults: { repo_detail: D(false, 2) },
    data: "mock",
  },

  // ─────────────────────────────────────────────────────────────────
  // VERIFY
  // ─────────────────────────────────────────────────────────────────
  {
    id: "harness",
    title: "Harness",
    description:
      "The constraint surface: linters, structural tests, ADRs, skills, policies — and their pass rate.",
    section: "harness",
    category: "verify",
    size: "half",
    defaults: {
      repo_detail: D(true, 1),
      home: D(true, 1),
    },
    data: "hybrid",
  },
  {
    id: "mistake_encoded",
    title: "Mistake encoded",
    description:
      "Pulses each time an agent mistake produced a new harness rule, ADR, or test gate.",
    section: "harness",
    category: "verify",
    size: "half",
    defaults: { repo_detail: D(true, 2) },
    data: "hybrid",
  },
  {
    id: "ci_in_flight",
    title: "CI for tasks in flight",
    description: "Live CI status from check_run / check_suite / workflow_run.",
    section: "verify",
    category: "verify",
    size: "half",
    defaults: { repo_detail: D(true, 0) },
    data: "live",
  },
  {
    id: "verifier_confidence",
    title: "Verifier confidence",
    description:
      "Per-PR acceptance-criteria coverage — how much of the spec the test suite verifies.",
    section: "verify",
    category: "verify",
    size: "half",
    defaults: { repo_detail: D(false, 1) },
    data: "hybrid",
  },
  {
    id: "quality_gauntlet",
    title: "Quality-gate gauntlet",
    description:
      "Animated gauntlet showing each PR pass through lint → unit → SCA → security → policy gates.",
    section: "verify",
    category: "verify",
    size: "full",
    defaults: { repo_detail: D(false, 2) },
    data: "mock",
  },
  {
    id: "failure_modes",
    title: "Failure modes (30d)",
    description:
      "Donut of where agents fail most: spec ambiguity, hallucinated deps, test gap, policy breach…",
    section: "verify",
    category: "verify",
    size: "half",
    defaults: { repo_detail: D(false, 3) },
    data: "mock",
  },

  // ─────────────────────────────────────────────────────────────────
  // DELIVER
  // ─────────────────────────────────────────────────────────────────
  {
    id: "deploy_health",
    title: "Deployment health",
    description:
      "Per-environment health, recent deploys, success rate, MTTR, failure reasons.",
    section: "deliver",
    category: "deliver",
    size: "half",
    defaults: { repo_detail: D(true, 0) },
    data: "live",
  },
  {
    id: "provenance_sbom",
    title: "Provenance / SBOM",
    description:
      "Model, harness version, SBOM hash, signature, SLSA level per agent-generated artifact.",
    section: "deliver",
    category: "deliver",
    size: "half",
    defaults: { repo_detail: D(true, 1) },
    data: "mock",
  },
  {
    id: "blast_radius",
    title: "Blast radius",
    description:
      "Pre-merge preview of services, DBs, and endpoints a PR will touch.",
    section: "deliver_detail",
    category: "deliver",
    size: "half",
    defaults: { repo_detail: D(false, 0) },
    data: "mock",
  },
  {
    id: "rollback_rehearsal",
    title: "Rollback rehearsal",
    description:
      "How recently each environment's rollback path was exercised.",
    section: "deliver_detail",
    category: "deliver",
    size: "half",
    defaults: { repo_detail: D(false, 1) },
    data: "mock",
  },

  // ─────────────────────────────────────────────────────────────────
  // OBSERVE
  // ─────────────────────────────────────────────────────────────────
  {
    id: "prod_signal_wire",
    title: "Prod signal → spec",
    description:
      "Production signals (SLO breach, ticket spike) flow back to create an epic.",
    section: "observe",
    category: "observe",
    size: "half",
    defaults: { repo_detail: D(false, 0) },
    data: "mock",
  },
  {
    id: "pr_prod_sparkline",
    title: "Prod metric per PR",
    description:
      "24h sparkline of latency / error rate / cost for each merged PR.",
    section: "observe",
    category: "observe",
    size: "half",
    defaults: { repo_detail: D(false, 1) },
    data: "mock",
  },

  // ─────────────────────────────────────────────────────────────────
  // CONTEXT
  // ─────────────────────────────────────────────────────────────────
  {
    id: "changelog",
    title: "Changelog",
    description: "Merged epics, merged PRs, and successful deploys feed.",
    section: "hero",
    category: "deliver",
    size: "full",
    // Show the changelog at the very top of the repo page (after the
    // header card / mini ring). Order=1 keeps it behind the ship-loop
    // ring (order=0) so when both are visible the ring still anchors
    // the page above the changelog stripe.
    defaults: { repo_detail: D(true, 1) },
    data: "live",
  },
  {
    id: "snapshots",
    title: "Snapshot artifacts",
    description:
      "GitHub Actions outputs, deploy snapshots, recent agentic artifacts.",
    section: "context",
    category: "deliver",
    size: "half",
    defaults: { repo_detail: D(false, 1) },
    data: "live",
  },
  {
    id: "blackbox_audit",
    title: "Blackbox audit",
    description:
      "Human vs agent authorship, stale agent-generated modules, re-audit reminders.",
    section: "context",
    category: "verify",
    size: "half",
    defaults: { repo_detail: D(false, 2) },
    data: "mock",
  },
  {
    id: "event_feed",
    title: "Event feed",
    description: "Raw stream of GitHub events with type filters and replay.",
    section: "footer",
    category: "core",
    size: "full",
    defaults: { repo_detail: D(true, 1) },
    data: "live",
  },
] as const;

export type PanelRegistry = typeof PANEL_REGISTRY;

// Convenience lookups -------------------------------------------------------

const REGISTRY_INDEX: Record<PanelId, PanelDescriptor> = (() => {
  const out: Partial<Record<PanelId, PanelDescriptor>> = {};
  for (const entry of PANEL_REGISTRY) out[entry.id] = entry;
  return out as Record<PanelId, PanelDescriptor>;
})();

export function getPanel(id: PanelId): PanelDescriptor {
  return REGISTRY_INDEX[id];
}

export function listPanelsForSurface(surface: PanelSurface): PanelDescriptor[] {
  return PANEL_REGISTRY.filter((p) => p.defaults[surface] !== undefined);
}

export function listPanelsForSection(
  section: PanelSection,
  surface: PanelSurface,
): PanelDescriptor[] {
  return listPanelsForSurface(surface).filter((p) => p.section === section);
}

export const SECTION_ORDER: readonly PanelSection[] = [
  "hero",
  "agents",
  "epics",
  "harness",
  "verify",
  "execute",
  "deliver",
  "deliver_detail",
  "observe",
  "context",
  "footer",
] as const;

export const SECTION_LABELS: Record<PanelSection, string> = {
  hero: "Hero",
  agents: "Agents in action",
  epics: "Epics + rollups",
  harness: "Specify + harness",
  verify: "Verify",
  execute: "Execute detail",
  deliver: "Deliver",
  deliver_detail: "Deliver detail",
  observe: "Observe",
  context: "Context",
  footer: "Footer",
};

export const CATEGORY_LABELS: Record<PanelCategory, string> = {
  specify: "Specify",
  execute: "Execute",
  verify: "Verify",
  deliver: "Deliver",
  observe: "Observe",
  core: "Core",
};

// Tailwind tone classes per category — kept here so the chooser pill,
// the section header, and the data-tagged badges all draw from one
// table.
export const CATEGORY_TONE: Record<
  PanelCategory,
  { pill: string; pillActive: string; section: string }
> = {
  specify: {
    pill: "border-indigo-400/40 bg-indigo-500/10 text-indigo-200",
    pillActive: "border-indigo-400 bg-indigo-500/30 text-indigo-50 shadow-[0_0_10px_rgba(99,102,241,0.35)]",
    section: "text-indigo-200",
  },
  execute: {
    pill: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
    pillActive: "border-emerald-400 bg-emerald-500/30 text-emerald-50 shadow-[0_0_10px_rgba(16,185,129,0.35)]",
    section: "text-emerald-200",
  },
  verify: {
    pill: "border-cyan-400/40 bg-cyan-500/10 text-cyan-200",
    pillActive: "border-cyan-400 bg-cyan-500/30 text-cyan-50 shadow-[0_0_10px_rgba(34,211,238,0.35)]",
    section: "text-cyan-200",
  },
  deliver: {
    pill: "border-violet-400/40 bg-violet-500/10 text-violet-200",
    pillActive: "border-violet-400 bg-violet-500/30 text-violet-50 shadow-[0_0_10px_rgba(167,139,250,0.35)]",
    section: "text-violet-200",
  },
  observe: {
    pill: "border-amber-400/40 bg-amber-500/10 text-amber-200",
    pillActive: "border-amber-400 bg-amber-500/30 text-amber-50 shadow-[0_0_10px_rgba(251,191,36,0.35)]",
    section: "text-amber-200",
  },
  core: {
    pill: "border-border/40 bg-background/40 text-muted-foreground",
    pillActive: "border-primary/50 bg-primary/15 text-primary",
    section: "text-muted-foreground",
  },
};
