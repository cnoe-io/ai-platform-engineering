/**
 * Tests for WORKFLOW_RUNNER_ENABLED feature flag gating in AgentBuilderGallery.
 *
 * Verifies that:
 *  - When workflowRunnerEnabled=false (default): "Run Workflow" button and
 *    "Multi-Step Workflows" section are NOT rendered.
 *  - When workflowRunnerEnabled=true: both elements ARE rendered.
 *  - "Run in Chat" is always rendered regardless of the flag.
 *  - Skills gallery tab and quick-start cards are unaffected by the flag.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentBuilderGallery } from "../AgentBuilderGallery";
import type { AgentConfig } from "@/types/agent-config";

// ---------------------------------------------------------------------------
// Config mock — controlled per-test via mockWorkflowRunnerEnabled
// ---------------------------------------------------------------------------

let mockWorkflowRunnerEnabled = false;

jest.mock("@/lib/config", () => ({
  getConfig: jest.fn((key: string) => {
    if (key === "workflowRunnerEnabled") return mockWorkflowRunnerEnabled;
    return undefined;
  }),
  config: {},
}));

// ---------------------------------------------------------------------------
// Store / hook mocks
// ---------------------------------------------------------------------------

const mockLoadConfigs = jest.fn();
const mockDeleteConfig = jest.fn();
const mockToggleFavorite = jest.fn();
const mockIsFavorite = jest.fn().mockReturnValue(false);
const mockGetFavoriteConfigs = jest.fn().mockReturnValue([]);

jest.mock("@/store/agent-config-store", () => ({
  useAgentConfigStore: () => ({
    configs: mockConfigs(),
    isLoading: false,
    error: null,
    loadConfigs: mockLoadConfigs,
    deleteConfig: mockDeleteConfig,
    toggleFavorite: mockToggleFavorite,
    isFavorite: mockIsFavorite,
    getFavoriteConfigs: mockGetFavoriteConfigs,
  }),
}));

jest.mock("@/store/chat-store", () => ({
  useChatStore: () => ({
    createConversation: jest.fn(),
    setPendingMessage: jest.fn(),
  }),
}));

jest.mock("@/hooks/use-admin-role", () => ({
  useAdminRole: () => ({ isAdmin: false }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeQuickStart(id = "qs-1"): AgentConfig {
  return {
    id,
    name: "Incident Correlation & Root Cause Analysis",
    description: "Correlate incidents across PagerDuty, Jira, and ArgoCD.",
    category: "SRE",
    is_quick_start: true,
    is_system: true,
    owner_id: "system",
    tasks: [
      {
        display_text: "Correlate incidents",
        llm_prompt: "You are an SRE agent. Correlate the incident.",
        subagent: "caipe",
      },
    ],
    created_at: new Date(),
    updated_at: new Date(),
    thumbnail: "AlertTriangle",
  };
}

function makeWorkflow(id = "wf-1"): AgentConfig {
  return {
    id,
    name: "Multi-Step Deploy Workflow",
    description: "Deploy, verify, rollback if needed.",
    category: "ArgoCD",
    is_quick_start: false,
    is_system: true,
    owner_id: "system",
    tasks: [
      { display_text: "Deploy", llm_prompt: "Deploy the app.", subagent: "caipe" },
      { display_text: "Verify", llm_prompt: "Verify health.", subagent: "caipe" },
    ],
    created_at: new Date(),
    updated_at: new Date(),
  };
}

// Configs returned by the store — set per describe block
let _configs: AgentConfig[] = [];
function mockConfigs() {
  return _configs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderGallery(props: Partial<React.ComponentProps<typeof AgentBuilderGallery>> = {}) {
  return render(
    <AgentBuilderGallery
      onSelectConfig={jest.fn()}
      onRunQuickStart={jest.fn()}
      onEditConfig={jest.fn()}
      onCreateNew={jest.fn()}
      onImportYaml={jest.fn()}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentBuilderGallery — WORKFLOW_RUNNER_ENABLED=false (default)", () => {
  beforeEach(() => {
    mockWorkflowRunnerEnabled = false;
    _configs = [makeQuickStart(), makeWorkflow()];
  });

  it("does NOT render the Run Workflow button in the modal when the flag is off", () => {
    renderGallery();

    // Open the modal by clicking the quick-start card
    const card = screen.getByText("Incident Correlation & Root Cause Analysis");
    fireEvent.click(card);

    // Run in Chat must be present
    expect(screen.getByRole("button", { name: /run in chat/i })).toBeInTheDocument();

    // Run Workflow must be absent
    expect(screen.queryByRole("button", { name: /run workflow/i })).not.toBeInTheDocument();
  });

  it("does NOT render the Multi-Step Workflows section when the flag is off", () => {
    renderGallery();

    expect(screen.queryByText("Multi-Step Workflows")).not.toBeInTheDocument();
  });

  it("still renders the quick-start card gallery when the flag is off", () => {
    renderGallery();

    expect(screen.getByText("Incident Correlation & Root Cause Analysis")).toBeInTheDocument();
  });

  it("renders Run in Chat as the only action button in the modal", () => {
    renderGallery();

    const card = screen.getByText("Incident Correlation & Root Cause Analysis");
    fireEvent.click(card);

    const buttons = screen.getAllByRole("button");
    const runWorkflow = buttons.find(b => /run workflow/i.test(b.textContent ?? ""));
    expect(runWorkflow).toBeUndefined();
  });

  it("still renders Cancel button in the modal when the flag is off", () => {
    renderGallery();

    const card = screen.getByText("Incident Correlation & Root Cause Analysis");
    fireEvent.click(card);

    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});

describe("AgentBuilderGallery — WORKFLOW_RUNNER_ENABLED=true", () => {
  beforeEach(() => {
    mockWorkflowRunnerEnabled = true;
    _configs = [makeQuickStart(), makeWorkflow()];
  });

  it("renders the Run Workflow button in the modal when the flag is on", () => {
    renderGallery();

    const card = screen.getByText("Incident Correlation & Root Cause Analysis");
    fireEvent.click(card);

    expect(screen.getByRole("button", { name: /run workflow/i })).toBeInTheDocument();
  });

  it("renders the Multi-Step Workflows section when the flag is on", () => {
    renderGallery();

    expect(screen.getByText("Multi-Step Workflows")).toBeInTheDocument();
  });

  it("renders both Run in Chat and Run Workflow buttons in the modal", () => {
    renderGallery();

    const card = screen.getByText("Incident Correlation & Root Cause Analysis");
    fireEvent.click(card);

    expect(screen.getByRole("button", { name: /run in chat/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run workflow/i })).toBeInTheDocument();
  });

  it("displays the workflow card name in the Multi-Step Workflows section", () => {
    renderGallery();

    expect(screen.getByText("Multi-Step Deploy Workflow")).toBeInTheDocument();
  });

  it("calls onRunQuickStart when Run Workflow is clicked", () => {
    const onRunQuickStart = jest.fn();
    renderGallery({ onRunQuickStart });

    const card = screen.getByText("Incident Correlation & Root Cause Analysis");
    fireEvent.click(card);

    const btn = screen.getByRole("button", { name: /run workflow/i });
    fireEvent.click(btn);

    expect(onRunQuickStart).toHaveBeenCalledTimes(1);
  });
});

describe("AgentBuilderGallery — flag transition (disabled → enabled)", () => {
  it("reflects flag changes without remounting", () => {
    mockWorkflowRunnerEnabled = false;
    _configs = [makeQuickStart()];
    const { rerender, queryByRole } = render(
      <AgentBuilderGallery
        onSelectConfig={jest.fn()}
        onRunQuickStart={jest.fn()}
        onEditConfig={jest.fn()}
        onCreateNew={jest.fn()}
        onImportYaml={jest.fn()}
      />
    );

    // Open modal
    fireEvent.click(screen.getByText("Incident Correlation & Root Cause Analysis"));
    expect(queryByRole("button", { name: /run workflow/i })).not.toBeInTheDocument();

    // Simulate flag flip
    mockWorkflowRunnerEnabled = true;
    rerender(
      <AgentBuilderGallery
        onSelectConfig={jest.fn()}
        onRunQuickStart={jest.fn()}
        onEditConfig={jest.fn()}
        onCreateNew={jest.fn()}
        onImportYaml={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /run workflow/i })).toBeInTheDocument();
  });
});

describe("AgentBuilderGallery — Multi-Step section only with workflow configs", () => {
  it("does NOT render Multi-Step section even when enabled if there are no workflow configs", () => {
    mockWorkflowRunnerEnabled = true;
    _configs = [makeQuickStart()]; // no multi-step configs

    renderGallery();

    expect(screen.queryByText("Multi-Step Workflows")).not.toBeInTheDocument();
  });

  it("does NOT render Multi-Step section when disabled even if workflow configs exist", () => {
    mockWorkflowRunnerEnabled = false;
    _configs = [makeWorkflow()];

    renderGallery();

    expect(screen.queryByText("Multi-Step Workflows")).not.toBeInTheDocument();
  });
});
