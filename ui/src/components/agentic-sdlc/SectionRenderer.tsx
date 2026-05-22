"use client";

/**
 * SectionRenderer — given a section name and a resolved layout
 * (sectionId → panel ids), emit the configured panels in the
 * configured order using a responsive grid.
 *
 * Layout rules:
 *   - At xl and above, half-size panels live in a 2-column grid and
 *     full-size panels span the row.
 *   - Below xl, every panel takes the full width.
 *
 * The mapping from PanelId to a concrete React component lives in
 * PANEL_COMPONENTS below. Wave 1 wires the existing panels and
 * stubs the rest with PanelPlaceholder so the chooser is fully
 * functional today.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import type { ReactNode } from "react";

import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import { PanelPlaceholder } from "@/components/agentic-sdlc/PanelPlaceholder";
import { RepoCiPanel } from "@/components/agentic-sdlc/RepoCiPanel";
import { RepoChangelogPanel } from "@/components/agentic-sdlc/RepoChangelogPanel";
import { RepoDeploymentHealthPanel } from "@/components/agentic-sdlc/RepoDeploymentHealthPanel";
import { RepoEpicList } from "@/components/agentic-sdlc/RepoEpicList";
import { RepoEventFeed } from "@/components/agentic-sdlc/RepoEventFeed";
import { RepoOperatingMetrics } from "@/components/agentic-sdlc/RepoOperatingMetrics";
import { RepoSnapshotsPanel } from "@/components/agentic-sdlc/RepoSnapshotsPanel";
import { RepoSwimLanes } from "@/components/agentic-sdlc/RepoSwimLanes";
import { ShipLoopRingPanel } from "@/components/agentic-sdlc/panels/ShipLoopRingPanel";
// AgenticSdlcAnimation is consumed inside ShipLoopRingPanel.
import { SpecHealthPanel } from "@/components/agentic-sdlc/panels/SpecHealthPanel";
import {
  AgentBudgetPanel,
  AgentRosterPanel,
  BlackboxAuditPanel,
  BlastRadiusPanel,
  FailureModesPanel,
  HarnessPanel,
  IntentDriftPanel,
  MistakeEncodedPanel,
  ParallelFanoutPanel,
  PrProdSparklinePanel,
  ProdSignalPanel,
  ProvenancePanel,
  QualityGauntletPanel,
  RollbackRehearsalPanel,
  SpecKitReplayPanel,
  VerifierConfidencePanel,
} from "@/components/agentic-sdlc/panels/InsightPanels";
import {
  getPanel,
  type PanelId,
  type PanelSection,
} from "@/lib/agentic-sdlc/panel-registry";

export interface PanelContext {
  owner?: string;
  repo?: string;
  fullName?: string;
}

interface SectionRendererProps {
  section: PanelSection;
  panelIds: PanelId[];
  context: PanelContext;
  "aria-label"?: string;
}

export function SectionRenderer({
  section,
  panelIds,
  context,
  ...rest
}: SectionRendererProps) {
  if (panelIds.length === 0) return null;

  const panels = panelIds.map((id) => ({
    id,
    desc: getPanel(id),
    node: renderPanel(id, context),
  }));

  // Split the section into runs separated by full-width panels so each
  // run of half-size panels can flow as a masonry-style 2-column layout
  // at xl (CSS columns) and tile without leaving height gaps. Full
  // panels render as their own row.
  const runs: Array<
    | { kind: "full"; panel: (typeof panels)[number] }
    | { kind: "half"; panels: typeof panels }
  > = [];
  let buffer: typeof panels = [];
  const flushHalves = () => {
    if (buffer.length > 0) {
      runs.push({ kind: "half", panels: buffer });
      buffer = [];
    }
  };
  for (const p of panels) {
    if (p.desc.size === "full") {
      flushHalves();
      runs.push({ kind: "full", panel: p });
    } else {
      buffer.push(p);
    }
  }
  flushHalves();

  return (
    <section
      aria-label={rest["aria-label"] ?? section}
      className="flex flex-col gap-4"
    >
      {runs.map((run, idx) =>
        run.kind === "full" ? (
          <div key={`${section}-full-${run.panel.id}-${idx}`} className="min-w-0">
            {run.panel.node}
          </div>
        ) : (
          <div
            key={`${section}-row-${idx}`}
            className="xl:columns-2 xl:[column-gap:1rem]"
          >
            {run.panels.map((p) => (
              <div key={p.id} className="mb-4 break-inside-avoid">
                {p.node}
              </div>
            ))}
          </div>
        ),
      )}
    </section>
  );
}

export function renderPanel(id: PanelId, ctx: PanelContext): ReactNode {
  const { owner = "", repo = "", fullName = `${owner}/${repo}` } = ctx;

  switch (id) {
    case "ship_loop_ring":
      return <ShipLoopRingPanel owner={owner} repo={repo} />;
    case "swim_lanes":
      return <RepoSwimLanes owner={owner} repo={repo} />;
    case "epics":
      return (
        <CollapsiblePanel
          title="Epics"
          subtitle={
            <span className="flex items-center justify-between gap-3">
              <span>Drill into active loops and repo-level Epics.</span>
              <span className="text-[11px] text-muted-foreground/70">
                {fullName}
              </span>
            </span>
          }
          className="min-w-0"
        >
          <RepoEpicList owner={owner} repo={repo} />
        </CollapsiblePanel>
      );
    case "operating_metrics":
      return <RepoOperatingMetrics owner={owner} repo={repo} />;
    case "ci_in_flight":
      return <RepoCiPanel owner={owner} repo={repo} />;
    case "changelog":
      return <RepoChangelogPanel owner={owner} repo={repo} />;
    case "snapshots":
      return <RepoSnapshotsPanel owner={owner} repo={repo} />;
    case "deploy_health":
      return <RepoDeploymentHealthPanel owner={owner} repo={repo} />;
    case "event_feed":
      return <RepoEventFeed owner={owner} repo={repo} />;
    case "spec_health":
      return <SpecHealthPanel owner={owner} repo={repo} />;
    case "intent_drift":
      return <IntentDriftPanel owner={owner} repo={repo} />;
    case "spec_kit_replay":
      return <SpecKitReplayPanel owner={owner} repo={repo} />;
    case "agent_roster":
      return <AgentRosterPanel owner={owner} repo={repo} />;
    case "agent_budget":
      return <AgentBudgetPanel owner={owner} repo={repo} />;
    case "parallel_fanout":
      return <ParallelFanoutPanel owner={owner} repo={repo} />;
    case "harness":
      return <HarnessPanel owner={owner} repo={repo} />;
    case "mistake_encoded":
      return <MistakeEncodedPanel owner={owner} repo={repo} />;
    case "verifier_confidence":
      return <VerifierConfidencePanel owner={owner} repo={repo} />;
    case "quality_gauntlet":
      return <QualityGauntletPanel owner={owner} repo={repo} />;
    case "failure_modes":
      return <FailureModesPanel owner={owner} repo={repo} />;
    case "provenance_sbom":
      return <ProvenancePanel owner={owner} repo={repo} />;
    case "blast_radius":
      return <BlastRadiusPanel owner={owner} repo={repo} />;
    case "rollback_rehearsal":
      return <RollbackRehearsalPanel owner={owner} repo={repo} />;
    case "prod_signal_wire":
      return <ProdSignalPanel owner={owner} repo={repo} />;
    case "pr_prod_sparkline":
      return <PrProdSparklinePanel owner={owner} repo={repo} />;
    case "blackbox_audit":
      return <BlackboxAuditPanel owner={owner} repo={repo} />;
    default:
      return <PanelPlaceholder panelId={id} />;
  }
}
