/**
 * @jest-environment jsdom
 *
 * Render-smoke tests for the four visualisation primitives. We
 * stay shallow here because the design system + accessibility
 * tests for ShipLoopAnimation / SwimLanePreview already exercise
 * deeper rendering. The contract this suite pins:
 *
 *   - StageBadge picks visuals from STAGE_VISUALS by stage
 *   - PipelineView renders ALL eight orbit stages even when empty
 *   - PipelineView places artifacts in the column matching their
 *     current_stage
 *   - KanbanView buckets observe + deploy into the deploy lane
 *   - KanbanView marks "Needs you" cards visually
 *   - TimelineView renders an empty-state placeholder when there
 *     are no events
 */
import { render, screen, within } from "@testing-library/react";
import {
  ORBIT_STAGES,
  STAGE_VISUALS,
} from "@/components/ship-loop/visualizations/stage-visuals";
import { StageBadge } from "@/components/ship-loop/visualizations/StageBadge";
import { PipelineView } from "@/components/ship-loop/visualizations/PipelineView";
import { KanbanView } from "@/components/ship-loop/visualizations/KanbanView";
import { TimelineView } from "@/components/ship-loop/visualizations/TimelineView";

function makeArtifact(overrides: Record<string, unknown> = {}) {
  return {
    repo_id: "99000001",
    kind: "subtask",
    artifact_id: "T_1",
    epic_id: "I_42",
    parent_subtask_id: null,
    title: "Sample subtask",
    body_excerpt: "",
    state: "open",
    current_stage: "implement",
    assignees: [],
    requested_reviewers: [],
    labels: [],
    agent_labels: [],
    needs_human: false,
    stalled_since: null,
    last_event_at: new Date(),
    github_url: "https://github.com/x/y/issues/1",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe("StageBadge", () => {
  it("renders the visual.label as the aria-label per stage", () => {
    render(<StageBadge stage="review_hitl" />);
    expect(
      screen.getByRole("status", { name: /Stage: Review/ }),
    ).toBeInTheDocument();
  });

  it("hides label text in compact mode but keeps the aria-label", () => {
    const { container } = render(<StageBadge stage="implement" compact />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      `Stage: ${STAGE_VISUALS.implement.label}`,
    );
    // The visible text node should not contain "Implement"
    expect(container.textContent).not.toMatch(/Implement/);
  });
});

describe("PipelineView", () => {
  it("renders one column per orbit stage even when empty", () => {
    render(
      <PipelineView
        epic={null}
        subtasks={[]}
        pull_requests={[]}
        deploys={[]}
        needsMe={[]}
      />,
    );
    for (const stage of ORBIT_STAGES) {
      expect(
        screen.getByRole("listitem", { name: STAGE_VISUALS[stage].label }),
      ).toBeInTheDocument();
    }
  });

  it("places an artifact into the column matching its current_stage", () => {
    render(
      <PipelineView
        epic={null}
        subtasks={[
          makeArtifact({
            artifact_id: "T_implement",
            title: "implement-task-title",
            current_stage: "implement",
          }),
        ]}
        pull_requests={[
          makeArtifact({
            kind: "pull_request",
            artifact_id: "PR_review",
            title: "review-pr-title",
            current_stage: "review_hitl",
          }),
        ]}
        deploys={[]}
        needsMe={[]}
      />,
    );
    const implementCol = screen.getByRole("listitem", {
      name: STAGE_VISUALS.implement.label,
    });
    expect(within(implementCol).getByText("implement-task-title")).toBeInTheDocument();

    const reviewCol = screen.getByRole("listitem", {
      name: STAGE_VISUALS.review_hitl.label,
    });
    expect(within(reviewCol).getByText("review-pr-title")).toBeInTheDocument();

    // Empty cols should render the "empty" placeholder.
    const observeCol = screen.getByRole("listitem", {
      name: STAGE_VISUALS.observe.label,
    });
    expect(within(observeCol).getByText(/empty/i)).toBeInTheDocument();
  });
});

describe("KanbanView", () => {
  it("buckets observe + deploy stages into the Deploy lane and marks needs-you", () => {
    render(
      <KanbanView
        subtasks={[]}
        pull_requests={[
          makeArtifact({
            kind: "pull_request",
            artifact_id: "PR_needs",
            title: "needs-me-pr",
            current_stage: "review_hitl",
          }),
        ]}
        deploys={[
          makeArtifact({
            kind: "deploy",
            artifact_id: "D_obs",
            title: "deploy-in-observe",
            current_stage: "observe",
          }),
          makeArtifact({
            kind: "deploy",
            artifact_id: "D_dep",
            title: "deploy-in-deploy",
            current_stage: "deploy",
          }),
        ]}
        needsMe={["PR_needs"]}
      />,
    );
    const reviewLane = screen.getByRole("listitem", { name: "Review" });
    expect(within(reviewLane).getByText("needs-me-pr")).toBeInTheDocument();
    // Needs-you marker should be visible inside that card.
    expect(within(reviewLane).getByText(/needs you/i)).toBeInTheDocument();

    const deployLane = screen.getByRole("listitem", { name: "Deploy" });
    expect(within(deployLane).getByText("deploy-in-observe")).toBeInTheDocument();
    expect(within(deployLane).getByText("deploy-in-deploy")).toBeInTheDocument();
  });
});

describe("TimelineView", () => {
  it("renders an empty state when no events are present", () => {
    render(<TimelineView events={[]} />);
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
  });

  it("renders a row per event with type and actor", () => {
    render(
      <TimelineView
        events={[
          {
            repo_id: "1",
            source: "github",
            github_delivery_id: "d-1",
            github_event_type: "issues",
            github_action: "opened",
            artifact_kind: "epic",
            artifact_id: "I_1",
            epic_id: "I_1",
            actor_kind: "human",
            actor_login: "alice",
            delivered_at: new Date(),
            occurred_at: new Date(),
            projection_status: "projected",
            projection_attempts: 1,
          },
        ]}
      />,
    );
    expect(screen.getByText(/issues · opened/)).toBeInTheDocument();
    expect(screen.getByText(/alice/)).toBeInTheDocument();
  });
});
