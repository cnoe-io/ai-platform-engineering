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

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "test@example.com" } }, status: "authenticated" }),
}));

jest.mock("framer-motion", () => ({
  motion: {
    div: React.forwardRef(({ children, ...rest }: any, ref: any) => (
      <div ref={ref} {...rest}>{children}</div>
    )),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

jest.mock("@/components/ui/caipe-spinner", () => ({
  CAIPESpinner: ({ message }: any) => <div data-testid="spinner">{message}</div>,
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

    expect(screen.getAllByText("Multi-Step Deploy Workflow").length).toBeGreaterThan(0);
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

// ---------------------------------------------------------------------------
// Search & filter
// ---------------------------------------------------------------------------

describe("AgentBuilderGallery — search and filter", () => {
  beforeEach(() => {
    mockWorkflowRunnerEnabled = false;
    _configs = [
      makeQuickStart("qs-1"),
      { ...makeQuickStart("qs-devops"), name: "DevOps Health Check", description: "Check cluster health", category: "DevOps" },
      { ...makeQuickStart("qs-cloud"), name: "Cost Explorer", description: "Analyze AWS costs", category: "Cloud" },
    ] as AgentConfig[];
  });

  it("filters configs by search query matching name", () => {
    renderGallery();

    const searchInput = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(searchInput, { target: { value: "DevOps" } });

    expect(screen.getByText("DevOps Health Check")).toBeInTheDocument();
    expect(screen.queryByText("Cost Explorer")).not.toBeInTheDocument();
  });

  it("filters configs by search query matching description", () => {
    renderGallery();

    const searchInput = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(searchInput, { target: { value: "AWS costs" } });

    expect(screen.getByText("Cost Explorer")).toBeInTheDocument();
    expect(screen.queryByText("DevOps Health Check")).not.toBeInTheDocument();
  });

  it("shows all configs when search query is empty", () => {
    renderGallery();

    expect(screen.getByText("Incident Correlation & Root Cause Analysis")).toBeInTheDocument();
    expect(screen.getByText("DevOps Health Check")).toBeInTheDocument();
    expect(screen.getByText("Cost Explorer")).toBeInTheDocument();
  });

  it("filters by category button", () => {
    renderGallery();

    const cloudBtn = screen.getByRole("button", { name: "Cloud" });
    fireEvent.click(cloudBtn);

    expect(screen.getByText("Cost Explorer")).toBeInTheDocument();
    expect(screen.queryByText("DevOps Health Check")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// updateEditablePrompt – variable substitution
// ---------------------------------------------------------------------------

describe("AgentBuilderGallery — variable substitution in run modal", () => {
  beforeEach(() => {
    mockWorkflowRunnerEnabled = false;
    _configs = [{
      ...makeQuickStart("qs-vars"),
      name: "Deploy Helper",
      tasks: [{
        display_text: "Deploy",
        llm_prompt: "Deploy {{app_name}} to {{cluster}}",
        subagent: "caipe",
      }],
      input_form: {
        title: "Deploy Helper",
        fields: [
          { name: "app_name", label: "App Name", type: "text" as const, required: true, placeholder: "Enter app name" },
          { name: "cluster", label: "Cluster", type: "text" as const, required: true, placeholder: "Enter cluster" },
        ],
      },
    }] as AgentConfig[];
  });

  it("replaces {{variables}} in the prompt when form fields are filled", () => {
    renderGallery();

    fireEvent.click(screen.getByText("Deploy Helper"));

    const appInput = screen.getByPlaceholderText(/enter app name/i);
    fireEvent.change(appInput, { target: { value: "my-service" } });

    const clusterInput = screen.getByPlaceholderText(/enter cluster/i);
    fireEvent.change(clusterInput, { target: { value: "prod-us" } });

    const promptArea = screen.getByPlaceholderText(/enter your prompt/i) as HTMLTextAreaElement;
    expect(promptArea.value).toBe("Deploy my-service to prod-us");
  });

  it("shows validation error for required empty field on submit", () => {
    renderGallery();

    fireEvent.click(screen.getByText("Deploy Helper"));

    const runBtn = screen.getByRole("button", { name: /run in chat/i });
    fireEvent.click(runBtn);

    expect(screen.getByText(/app name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/cluster is required/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Delete flow
// ---------------------------------------------------------------------------

describe("AgentBuilderGallery — delete", () => {
  beforeEach(() => {
    mockWorkflowRunnerEnabled = false;
    mockDeleteConfig.mockClear();
    _configs = [{
      ...makeQuickStart("qs-del"),
      is_system: false,
      owner_id: "test@example.com",
    }] as AgentConfig[];
    jest.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    (window.confirm as jest.Mock).mockRestore();
  });

  it("calls deleteConfig when user confirms deletion", async () => {
    renderGallery();

    const deleteButtons = screen.getAllByTitle("Delete template");
    fireEvent.click(deleteButtons[0]);

    expect(mockDeleteConfig).toHaveBeenCalledWith("qs-del");
  });

  it("does NOT call deleteConfig when user cancels", () => {
    (window.confirm as jest.Mock).mockReturnValue(false);

    renderGallery();

    const deleteButtons = screen.getAllByTitle("Delete template");
    fireEvent.click(deleteButtons[0]);

    expect(mockDeleteConfig).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Skills Builder button
// ---------------------------------------------------------------------------

describe("AgentBuilderGallery — Skills Builder button", () => {
  beforeEach(() => {
    mockWorkflowRunnerEnabled = false;
    _configs = [makeQuickStart()];
  });

  it("calls onCreateNew when Skills Builder button is clicked", () => {
    const onCreateNew = jest.fn();
    renderGallery({ onCreateNew });

    const btn = screen.getByRole("button", { name: /skills builder/i });
    fireEvent.click(btn);

    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// canModifyConfig logic (via UI – edit/delete visibility)
// ---------------------------------------------------------------------------

describe("AgentBuilderGallery — canModifyConfig", () => {
  it("shows edit/delete buttons for non-system configs", () => {
    mockWorkflowRunnerEnabled = false;
    _configs = [{
      ...makeQuickStart("user-skill"),
      is_system: false,
      owner_id: "test@example.com",
    }] as AgentConfig[];

    renderGallery();

    expect(screen.getAllByTitle("Edit template").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Delete template").length).toBeGreaterThan(0);
  });
});
