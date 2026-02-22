/**
 * Tests for SkillsGallery component.
 *
 * Covers:
 *  - WORKFLOW_RUNNER_ENABLED feature flag gating
 *  - Search/filter by name, description, category
 *  - Variable substitution in run modal
 *  - Delete confirm/cancel flow
 *  - Run in Chat flow (createConversation, setPendingMessage, navigation)
 *  - View mode switching (all, my-skills, global, workflows)
 *  - canModifyConfig logic (admin vs non-admin, system vs user configs)
 *  - Favorites section and toggle
 *  - Loading/error states
 *  - Empty states
 *  - Editable prompt and disabled buttons
 *  - Modal interactions (backdrop, X button, Cancel)
 *  - Edit config and onSelectConfig callbacks
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SkillsGallery } from "../SkillsGallery";
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
// Store / hook mocks — controllable per-test
// ---------------------------------------------------------------------------

const mockLoadConfigs = jest.fn();
const mockDeleteConfig = jest.fn();
const mockToggleFavorite = jest.fn();
const mockIsFavorite = jest.fn().mockReturnValue(false);
const mockGetFavoriteConfigs = jest.fn().mockReturnValue([]);
const mockCreateConversation = jest.fn().mockReturnValue("conv-abc");
const mockSetPendingMessage = jest.fn();
const mockRouterPush = jest.fn();

let mockIsLoading = false;
let mockError: string | null = null;
let mockIsAdmin = false;

jest.mock("@/store/agent-config-store", () => ({
  useAgentConfigStore: () => ({
    configs: mockConfigs(),
    isLoading: mockIsLoading,
    error: mockError,
    loadConfigs: mockLoadConfigs,
    deleteConfig: mockDeleteConfig,
    toggleFavorite: mockToggleFavorite,
    isFavorite: mockIsFavorite,
    getFavoriteConfigs: mockGetFavoriteConfigs,
  }),
}));

jest.mock("@/store/chat-store", () => ({
  useChatStore: () => ({
    createConversation: mockCreateConversation,
    setPendingMessage: mockSetPendingMessage,
  }),
}));

jest.mock("@/hooks/use-admin-role", () => ({
  useAdminRole: () => ({ isAdmin: mockIsAdmin }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
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

function renderGallery(props: Partial<React.ComponentProps<typeof SkillsGallery>> = {}) {
  return render(
    <SkillsGallery
      onSelectConfig={jest.fn()}
      onRunQuickStart={jest.fn()}
      onEditConfig={jest.fn()}
      onCreateNew={jest.fn()}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Global reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkflowRunnerEnabled = false;
  mockIsLoading = false;
  mockError = null;
  mockIsAdmin = false;
  mockIsFavorite.mockReturnValue(false);
  mockGetFavoriteConfigs.mockReturnValue([]);
  mockCreateConversation.mockReturnValue("conv-abc");
  _configs = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillsGallery — WORKFLOW_RUNNER_ENABLED=false (default)", () => {
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

describe("SkillsGallery — WORKFLOW_RUNNER_ENABLED=true", () => {
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

describe("SkillsGallery — flag transition (disabled → enabled)", () => {
  it("reflects flag changes without remounting", () => {
    mockWorkflowRunnerEnabled = false;
    _configs = [makeQuickStart()];
    const { rerender, queryByRole } = render(
      <SkillsGallery
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
      <SkillsGallery
        onSelectConfig={jest.fn()}
        onRunQuickStart={jest.fn()}
        onEditConfig={jest.fn()}
        onCreateNew={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /run workflow/i })).toBeInTheDocument();
  });
});

describe("SkillsGallery — Multi-Step section only with workflow configs", () => {
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

describe("SkillsGallery — search and filter", () => {
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

describe("SkillsGallery — variable substitution in run modal", () => {
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

describe("SkillsGallery — delete", () => {
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

describe("SkillsGallery — Skills Builder button", () => {
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

describe("SkillsGallery — canModifyConfig", () => {
  it("shows edit/delete buttons for non-system configs", () => {
    _configs = [{
      ...makeQuickStart("user-skill"),
      is_system: false,
      owner_id: "test@example.com",
    }] as AgentConfig[];

    renderGallery();

    expect(screen.getAllByTitle("Edit template").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Delete template").length).toBeGreaterThan(0);
  });

  it("admin sees edit/delete buttons on system configs", () => {
    mockIsAdmin = true;
    _configs = [makeQuickStart("sys-1")];

    renderGallery();

    expect(screen.getAllByTitle("Edit template").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Delete template").length).toBeGreaterThan(0);
  });

  it("non-admin does NOT see edit/delete on system configs", () => {
    mockIsAdmin = false;
    _configs = [makeQuickStart("sys-2")];

    renderGallery();

    expect(screen.queryByTitle("Edit template")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete template")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Run in Chat flow
// ---------------------------------------------------------------------------

describe("SkillsGallery — Run in Chat", () => {
  beforeEach(() => {
    _configs = [{
      ...makeQuickStart("qs-chat"),
      name: "Chat Skill",
      is_system: false,
      owner_id: "test@example.com",
      tasks: [{ display_text: "Do it", llm_prompt: "Perform the task", subagent: "caipe" }],
    }] as AgentConfig[];
  });

  it("calls createConversation, setPendingMessage, and router.push on Run in Chat", () => {
    renderGallery();

    fireEvent.click(screen.getByText("Chat Skill"));

    const runBtn = screen.getByRole("button", { name: /run in chat/i });
    fireEvent.click(runBtn);

    expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    expect(mockSetPendingMessage).toHaveBeenCalledWith("Perform the task");
    expect(mockRouterPush).toHaveBeenCalledWith("/chat/conv-abc");
  });

  it("closes the modal after navigation", () => {
    renderGallery();

    fireEvent.click(screen.getByText("Chat Skill"));
    expect(screen.getByRole("button", { name: /run in chat/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /run in chat/i }));

    expect(screen.queryByRole("button", { name: /run in chat/i })).not.toBeInTheDocument();
  });

  it("validation blocks Run in Chat when required fields are empty", () => {
    _configs = [{
      ...makeQuickStart("qs-form"),
      name: "Form Skill",
      is_system: false,
      owner_id: "test@example.com",
      tasks: [{ display_text: "Deploy", llm_prompt: "Deploy {{app}}", subagent: "caipe" }],
      input_form: {
        title: "Deploy",
        fields: [{ name: "app", label: "App", type: "text" as const, required: true, placeholder: "Enter app" }],
      },
    }] as AgentConfig[];

    renderGallery();
    fireEvent.click(screen.getByText("Form Skill"));
    fireEvent.click(screen.getByRole("button", { name: /run in chat/i }));

    expect(screen.getByText(/app is required/i)).toBeInTheDocument();
    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("uses the manually edited prompt, not the original template", () => {
    renderGallery();

    fireEvent.click(screen.getByText("Chat Skill"));

    const promptArea = screen.getByPlaceholderText(/enter your prompt/i) as HTMLTextAreaElement;
    fireEvent.change(promptArea, { target: { value: "Custom prompt text" } });

    fireEvent.click(screen.getByRole("button", { name: /run in chat/i }));

    expect(mockSetPendingMessage).toHaveBeenCalledWith("Custom prompt text");
  });
});

// ---------------------------------------------------------------------------
// View mode switching
// ---------------------------------------------------------------------------

describe("SkillsGallery — view mode", () => {
  const mySkill: AgentConfig = {
    ...makeQuickStart("my-1"),
    name: "My Personal Skill",
    is_system: false,
    owner_id: "test@example.com",
    visibility: "private",
  } as AgentConfig;

  const globalSkill: AgentConfig = {
    ...makeQuickStart("global-1"),
    name: "Global System Skill",
    is_system: true,
    owner_id: "system",
    visibility: "global",
  } as AgentConfig;

  const teamSkill: AgentConfig = {
    ...makeQuickStart("team-1"),
    name: "Team Shared Skill",
    is_system: false,
    owner_id: "other@example.com",
    visibility: "team",
  } as AgentConfig;

  beforeEach(() => {
    _configs = [mySkill, globalSkill, teamSkill];
  });

  it("My Skills view shows only user-owned non-system configs", () => {
    renderGallery();

    const allButtons = screen.getAllByRole("button");
    const mySkillsBtn = allButtons.find(b => b.textContent?.includes("My Skills"));
    fireEvent.click(mySkillsBtn!);

    expect(screen.getByText("My Personal Skill")).toBeInTheDocument();
    expect(screen.queryByText("Global System Skill")).not.toBeInTheDocument();
    expect(screen.queryByText("Team Shared Skill")).not.toBeInTheDocument();
  });

  it("Global view shows configs where visibility=global or is_system", () => {
    renderGallery();

    const allButtons = screen.getAllByRole("button");
    const globalBtn = allButtons.find(b => b.textContent?.trim() === "Global");
    fireEvent.click(globalBtn!);

    expect(screen.getByText("Global System Skill")).toBeInTheDocument();
    expect(screen.queryByText("My Personal Skill")).not.toBeInTheDocument();
  });

  it("Workflows view shows only is_quick_start=false configs when flag is on", () => {
    mockWorkflowRunnerEnabled = true;
    const wf = makeWorkflow("wf-view");
    _configs = [mySkill, wf];

    renderGallery();

    const allButtons = screen.getAllByRole("button");
    const multiStepBtn = allButtons.find(b => b.textContent?.includes("Multi-Step"));
    fireEvent.click(multiStepBtn!);

    expect(screen.getByText("Multi-Step Deploy Workflow")).toBeInTheDocument();
    expect(screen.queryByText("My Personal Skill")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

describe("SkillsGallery — favorites", () => {
  const favSkill: AgentConfig = {
    ...makeQuickStart("fav-1"),
    name: "Favorite Skill",
    is_system: false,
    owner_id: "test@example.com",
  } as AgentConfig;

  it("renders Favorites section when getFavoriteConfigs returns configs", () => {
    _configs = [favSkill];
    mockGetFavoriteConfigs.mockReturnValue([favSkill]);
    mockIsFavorite.mockImplementation((id: string) => id === "fav-1");

    renderGallery();

    expect(screen.getByText("Favorites")).toBeInTheDocument();
  });

  it("hides Favorites section when empty", () => {
    _configs = [makeQuickStart()];
    mockGetFavoriteConfigs.mockReturnValue([]);

    renderGallery();

    expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
  });

  it("clicking the star button calls toggleFavorite", () => {
    _configs = [{
      ...makeQuickStart("star-1"),
      name: "Star Skill",
      is_system: false,
      owner_id: "test@example.com",
    }] as AgentConfig[];

    renderGallery();

    const starBtn = screen.getByTitle("Add to favorites");
    fireEvent.click(starBtn);

    expect(mockToggleFavorite).toHaveBeenCalledWith("star-1");
  });
});

// ---------------------------------------------------------------------------
// Loading and error states
// ---------------------------------------------------------------------------

describe("SkillsGallery — loading/error", () => {
  it("renders spinner when isLoading=true", () => {
    mockIsLoading = true;
    _configs = [];

    renderGallery();

    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("renders error with Try Again button when error is set", () => {
    mockError = "Failed to load configs";
    _configs = [];

    renderGallery();

    expect(screen.getByText("Failed to load configs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("Try Again calls loadConfigs", () => {
    mockError = "Network error";
    _configs = [];
    mockLoadConfigs.mockClear();

    renderGallery();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(mockLoadConfigs).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

describe("SkillsGallery — empty states", () => {
  it("shows 'No skills match your search' when search yields no results", async () => {
    _configs = [makeQuickStart()];

    renderGallery();

    const searchInput = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(searchInput, { target: { value: "nonexistent-xyz" } });

    await waitFor(() => {
      expect(screen.getByText("No skills match your search")).toBeInTheDocument();
    });
  });

  it("My Skills empty state shows 'Create your first skill' with Skills Builder button", async () => {
    _configs = [makeQuickStart()];
    const onCreateNew = jest.fn();

    renderGallery({ onCreateNew });

    const allButtons = screen.getAllByRole("button");
    const mySkillsBtn = allButtons.find(b => b.textContent?.includes("My Skills"));
    fireEvent.click(mySkillsBtn!);

    await waitFor(() => {
      expect(screen.getByText(/create your first skill/i)).toBeInTheDocument();
    });
    const builderBtn = screen.getAllByRole("button").filter(b => /skills builder/i.test(b.textContent || ""));
    expect(builderBtn.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Editable prompt and disabled buttons
// ---------------------------------------------------------------------------

describe("SkillsGallery — editable prompt", () => {
  beforeEach(() => {
    _configs = [{
      ...makeQuickStart("qs-prompt"),
      name: "Prompt Skill",
      is_system: false,
      owner_id: "test@example.com",
      tasks: [{ display_text: "Run", llm_prompt: "Original prompt text", subagent: "caipe" }],
    }] as AgentConfig[];
  });

  it("editing the prompt textarea updates the editable prompt", () => {
    renderGallery();
    fireEvent.click(screen.getByText("Prompt Skill"));

    const promptArea = screen.getByPlaceholderText(/enter your prompt/i) as HTMLTextAreaElement;
    expect(promptArea.value).toBe("Original prompt text");

    fireEvent.change(promptArea, { target: { value: "Modified prompt" } });
    expect(promptArea.value).toBe("Modified prompt");
  });

  it("Run in Chat button is disabled when prompt is empty", () => {
    renderGallery();
    fireEvent.click(screen.getByText("Prompt Skill"));

    const promptArea = screen.getByPlaceholderText(/enter your prompt/i);
    fireEvent.change(promptArea, { target: { value: "" } });

    const runBtn = screen.getByRole("button", { name: /run in chat/i });
    expect(runBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Modal interactions
// ---------------------------------------------------------------------------

describe("SkillsGallery — modal interactions", () => {
  beforeEach(() => {
    _configs = [{
      ...makeQuickStart("qs-modal"),
      name: "Modal Skill",
      is_system: false,
      owner_id: "test@example.com",
    }] as AgentConfig[];
  });

  it("clicking Cancel closes modal", () => {
    renderGallery();
    fireEvent.click(screen.getByText("Modal Skill"));
    expect(screen.getByText("Prompt (editable)")).toBeInTheDocument();

    const cancelBtns = screen.getAllByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtns[0]);

    expect(screen.queryByText("Prompt (editable)")).not.toBeInTheDocument();
  });

  it("clicking backdrop closes modal", () => {
    renderGallery();
    fireEvent.click(screen.getByText("Modal Skill"));
    expect(screen.getByText("Prompt (editable)")).toBeInTheDocument();

    const backdrop = document.querySelector("[class*='fixed inset-0']") as HTMLElement;
    if (backdrop) fireEvent.click(backdrop);

    expect(screen.queryByText("Prompt (editable)")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Edit config callback
// ---------------------------------------------------------------------------

describe("SkillsGallery — edit callback", () => {
  it("calls onEditConfig for user-owned config when edit button is clicked", () => {
    const userConfig = {
      ...makeQuickStart("edit-1"),
      name: "Editable Skill",
      is_system: false,
      owner_id: "test@example.com",
    } as AgentConfig;
    _configs = [userConfig];

    const onEditConfig = jest.fn();
    renderGallery({ onEditConfig });

    const editBtn = screen.getByTitle("Edit template");
    fireEvent.click(editBtn);

    expect(onEditConfig).toHaveBeenCalledTimes(1);
    expect(onEditConfig).toHaveBeenCalledWith(expect.objectContaining({ id: "edit-1" }));
  });

  it("calls onEditConfig for system config when admin clicks edit", () => {
    mockIsAdmin = true;
    _configs = [makeQuickStart("sys-edit")];

    const onEditConfig = jest.fn();
    renderGallery({ onEditConfig });

    const editBtn = screen.getByTitle("Edit template");
    fireEvent.click(editBtn);

    expect(onEditConfig).toHaveBeenCalledTimes(1);
    expect(onEditConfig).toHaveBeenCalledWith(expect.objectContaining({ id: "sys-edit" }));
  });
});

// ---------------------------------------------------------------------------
// onSelectConfig for workflow cards
// ---------------------------------------------------------------------------

describe("SkillsGallery — onSelectConfig for workflows", () => {
  it("clicking a workflow card calls onSelectConfig when flag is on", () => {
    mockWorkflowRunnerEnabled = true;
    _configs = [makeWorkflow("wf-select")];

    const onSelectConfig = jest.fn();
    renderGallery({ onSelectConfig });

    const cards = screen.getAllByText("Multi-Step Deploy Workflow");
    fireEvent.click(cards[0]);

    expect(onSelectConfig).toHaveBeenCalledWith(expect.objectContaining({ id: "wf-select" }));
  });
});

// ---------------------------------------------------------------------------
// Variable defaults — {{variable:default}} support
// ---------------------------------------------------------------------------

describe("SkillsGallery — variable defaults ({{name:default}} syntax)", () => {
  beforeEach(() => {
    mockWorkflowRunnerEnabled = false;
    _configs = [{
      ...makeQuickStart("qs-defaults"),
      name: "Default Vars Skill",
      tasks: [{
        display_text: "Run defaults",
        llm_prompt: "Deploy {{app_name:my-service}} to {{cluster:prod-us}} with {{replicas:3}}",
        subagent: "caipe",
      }],
      input_form: {
        title: "Default Vars Skill",
        fields: [
          { name: "app_name", label: "App Name", type: "text" as const, required: false, placeholder: "Default: my-service", defaultValue: "my-service" },
          { name: "cluster", label: "Cluster", type: "text" as const, required: false, placeholder: "Default: prod-us", defaultValue: "prod-us" },
          { name: "replicas", label: "Replicas", type: "number" as const, required: false, placeholder: "Default: 3", defaultValue: "3" },
        ],
      },
    }] as AgentConfig[];
  });

  it("pre-fills form fields with default values", () => {
    renderGallery();

    fireEvent.click(screen.getByText("Default Vars Skill"));

    const appInput = screen.getByPlaceholderText(/default: my-service/i) as HTMLInputElement;
    expect(appInput.value).toBe("my-service");

    const clusterInput = screen.getByPlaceholderText(/default: prod-us/i) as HTMLInputElement;
    expect(clusterInput.value).toBe("prod-us");

    const replicasInput = screen.getByPlaceholderText(/default: 3/i) as HTMLInputElement;
    expect(replicasInput.value).toBe("3");
  });

  it("pre-substitutes defaults into the editable prompt", () => {
    renderGallery();

    fireEvent.click(screen.getByText("Default Vars Skill"));

    const promptArea = screen.getByPlaceholderText(/enter your prompt/i) as HTMLTextAreaElement;
    expect(promptArea.value).toBe("Deploy my-service to prod-us with 3");
  });

  it("allows overriding default values and updates prompt", () => {
    renderGallery();

    fireEvent.click(screen.getByText("Default Vars Skill"));

    const appInput = screen.getByPlaceholderText(/default: my-service/i);
    fireEvent.change(appInput, { target: { value: "new-service" } });

    const promptArea = screen.getByPlaceholderText(/enter your prompt/i) as HTMLTextAreaElement;
    expect(promptArea.value).toContain("new-service");
  });

  it("does not show validation error for optional (default) fields when empty", () => {
    // Clear the default value to simulate user clearing
    _configs = [{
      ...makeQuickStart("qs-optional"),
      name: "Optional Vars Skill",
      tasks: [{
        display_text: "Run",
        llm_prompt: "Deploy {required_app} to {{cluster:prod}}",
        subagent: "caipe",
      }],
      input_form: {
        title: "Optional Vars",
        fields: [
          { name: "required_app", label: "Required App", type: "text" as const, required: true, placeholder: "Enter required app" },
          { name: "cluster", label: "Cluster", type: "text" as const, required: false, placeholder: "Default: prod", defaultValue: "prod" },
        ],
      },
    }] as AgentConfig[];

    renderGallery();

    fireEvent.click(screen.getByText("Optional Vars Skill"));

    // Clear the optional field
    const clusterInput = screen.getByPlaceholderText(/default: prod/i);
    fireEvent.change(clusterInput, { target: { value: "" } });

    // Try to submit — only the required field should error
    const runBtn = screen.getByRole("button", { name: /run in chat/i });
    fireEvent.click(runBtn);

    expect(screen.getByText(/required app is required/i)).toBeInTheDocument();
    expect(screen.queryByText(/cluster is required/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Auto-generated input form (no explicit input_form, parsed from prompt)
// ---------------------------------------------------------------------------

describe("SkillsGallery — auto-generated form from prompt variables", () => {
  beforeEach(() => {
    mockWorkflowRunnerEnabled = false;
    _configs = [{
      ...makeQuickStart("qs-auto"),
      name: "Auto Form Skill",
      tasks: [{
        display_text: "Auto",
        llm_prompt: "Check the status of {{service_url}} on {{port_number:8080}}",
        subagent: "caipe",
      }],
      // No input_form — should be auto-generated from prompt variables
    }] as AgentConfig[];
  });

  it("auto-generates form fields from prompt variables", () => {
    renderGallery();

    fireEvent.click(screen.getByText("Auto Form Skill"));

    // Should detect service_url (required) and port_number (optional with default)
    expect(screen.getByText(/service url/i)).toBeInTheDocument();
    expect(screen.getByText(/port number/i)).toBeInTheDocument();
  });

  it("infers URL type for variable with 'url' in name", () => {
    renderGallery();

    fireEvent.click(screen.getByText("Auto Form Skill"));

    // The service_url field should be of type url
    const urlInput = screen.getByPlaceholderText(/enter service url/i);
    expect(urlInput).toBeInTheDocument();
    expect(urlInput).toHaveAttribute("type", "url");
  });

  it("infers number type for variable with 'number' in name", () => {
    renderGallery();

    fireEvent.click(screen.getByText("Auto Form Skill"));

    // port_number should have type number
    const numInput = screen.getByPlaceholderText(/default: 8080/i);
    expect(numInput).toBeInTheDocument();
    expect(numInput).toHaveAttribute("type", "number");
  });
});
