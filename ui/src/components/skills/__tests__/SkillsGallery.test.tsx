/**
 * Tests for SkillsGallery component.
 *
 * Covers:
 *  - WORKFLOW_RUNNER_ENABLED feature flag gating
 *  - Search/filter by name, description, category
 *  - Delete confirm/cancel flow
 *  - Try Skill flow (createConversation, setPendingMessage, navigation)
 *  - View mode switching (all, my-skills, global, workflows)
 *  - Edit/delete visibility (admin vs non-admin, system vs user configs)
 *  - Favorites section and toggle
 *  - Loading/error states
 *  - Empty states
 *  - Modal interactions (backdrop, X button, Cancel)
 *  - Edit config and onSelectConfig callbacks
 *  - Supervisor sync gating (Try Skill disabled when not synced)
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SkillsGallery } from "../SkillsGallery";
import type { AgentSkill } from "@/types/agent-skill";

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

jest.mock("@/store/agent-skills-store", () => ({
  useAgentSkillsStore: () => ({
    configs: mockConfigs(),
    isLoading: mockIsLoading,
    error: mockError,
    loadSkills: mockLoadConfigs,
    deleteSkill: mockDeleteConfig,
    toggleFavorite: mockToggleFavorite,
    isFavorite: mockIsFavorite,
    getFavoriteSkills: mockGetFavoriteConfigs,
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

function makeQuickStart(id = "qs-1"): AgentSkill {
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
        subagent: "user_input",
      },
    ],
    created_at: new Date(),
    updated_at: new Date(),
    thumbnail: "AlertTriangle",
  };
}

function makeWorkflow(id = "wf-1"): AgentSkill {
  return {
    id,
    name: "Multi-Step Deploy Workflow",
    description: "Deploy, verify, rollback if needed.",
    category: "ArgoCD",
    is_quick_start: false,
    is_system: true,
    owner_id: "system",
    tasks: [
      { display_text: "Deploy", llm_prompt: "Deploy the app.", subagent: "user_input" },
      { display_text: "Verify", llm_prompt: "Verify health.", subagent: "user_input" },
    ],
    created_at: new Date(),
    updated_at: new Date(),
  };
}

// Configs returned by the store — set per describe block
let _configs: AgentSkill[] = [];
function mockConfigs() {
  return _configs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderGallery(props: Partial<React.ComponentProps<typeof SkillsGallery>> = {}) {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <SkillsGallery
        onEditConfig={jest.fn()}
        onCreateNew={jest.fn()}
        {...props}
      />
    );
  });
  return result!;
}

// ---------------------------------------------------------------------------
// Global reset + fetch mock
// ---------------------------------------------------------------------------

let mockSupervisorSynced = true;

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkflowRunnerEnabled = false;
  mockIsLoading = false;
  mockError = null;
  mockIsAdmin = false;
  mockSupervisorSynced = true;
  mockIsFavorite.mockReturnValue(false);
  mockGetFavoriteConfigs.mockReturnValue([]);
  mockCreateConversation.mockReturnValue("conv-abc");
  _configs = [];

  // Mock global.fetch for supervisor-status and catalog endpoints
  global.fetch = jest.fn((url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

    if (urlStr.includes("/api/skills/supervisor-status")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          mas_registered: mockSupervisorSynced,
          skills_loaded_count: mockSupervisorSynced ? 5 : 0,
        }),
      } as Response);
    }

    if (urlStr.includes("/api/skills")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ skills: [] }),
      } as Response);
    }

    // Default: return empty OK response
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);
  }) as jest.Mock;
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillsGallery — WORKFLOW_RUNNER_ENABLED=false (default)", () => {
  beforeEach(() => {
    mockWorkflowRunnerEnabled = false;
    _configs = [makeQuickStart(), makeWorkflow()];
  });

  it("does NOT render the Multi-Step Workflows section when the flag is off", async () => {
    await renderGallery();
    expect(screen.queryByText("Multi-Step Workflows")).not.toBeInTheDocument();
  });

  it("still renders the quick-start card gallery when the flag is off", async () => {
    await renderGallery();
    expect(screen.getByText("Incident Correlation & Root Cause Analysis")).toBeInTheDocument();
  });

  it("opens modal with Try Skill button when clicking a skill card", async () => {
    await renderGallery();
    const card = screen.getByText("Incident Correlation & Root Cause Analysis");
    await act(async () => { fireEvent.click(card); });
    expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();
  });

  it("does NOT show Run Workflow or Run in Chat buttons in the modal", async () => {
    await renderGallery();
    const card = screen.getByText("Incident Correlation & Root Cause Analysis");
    await act(async () => { fireEvent.click(card); });
    expect(screen.queryByRole("button", { name: /run workflow/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run in chat/i })).not.toBeInTheDocument();
  });

  it("still renders Cancel button in the modal when the flag is off", async () => {
    await renderGallery();
    const card = screen.getByText("Incident Correlation & Root Cause Analysis");
    await act(async () => { fireEvent.click(card); });
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});

describe("SkillsGallery — WORKFLOW_RUNNER_ENABLED=true", () => {
  beforeEach(() => {
    mockWorkflowRunnerEnabled = true;
    _configs = [makeQuickStart(), makeWorkflow()];
  });

  it("renders the Multi-Step Workflows section when the flag is on", async () => {
    await renderGallery();
    expect(screen.getByText("Multi-Step Workflows")).toBeInTheDocument();
  });

  it("opens modal and shows Try Skill button when clicking a quick-start card", async () => {
    await renderGallery();
    const card = screen.getByText("Incident Correlation & Root Cause Analysis");
    await act(async () => { fireEvent.click(card); });
    expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();
  });

  it("displays the workflow card name in the Multi-Step Workflows section", async () => {
    await renderGallery();
    expect(screen.getAllByText("Multi-Step Deploy Workflow").length).toBeGreaterThan(0);
  });
});

describe("SkillsGallery — flag transition (disabled → enabled)", () => {
  it("reflects flag changes without remounting", async () => {
    mockWorkflowRunnerEnabled = false;
    _configs = [makeQuickStart()];
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <SkillsGallery onEditConfig={jest.fn()} onCreateNew={jest.fn()} />
      );
    });

    // Open modal
    await act(async () => {
      fireEvent.click(screen.getByText("Incident Correlation & Root Cause Analysis"));
    });
    expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();

    // Simulate flag flip
    mockWorkflowRunnerEnabled = true;
    await act(async () => {
      result!.rerender(
        <SkillsGallery onEditConfig={jest.fn()} onCreateNew={jest.fn()} />
      );
    });

    expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();
  });
});

describe("SkillsGallery — Multi-Step section only with workflow configs", () => {
  it("does NOT render Multi-Step section even when enabled if there are no workflow configs", async () => {
    mockWorkflowRunnerEnabled = true;
    _configs = [makeQuickStart()]; // no multi-step configs
    await renderGallery();
    expect(screen.queryByText("Multi-Step Workflows")).not.toBeInTheDocument();
  });

  it("does NOT render Multi-Step section when disabled even if workflow configs exist", async () => {
    mockWorkflowRunnerEnabled = false;
    _configs = [makeWorkflow()];
    await renderGallery();
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
    ] as AgentSkill[];
  });

  it("filters configs by search query matching name", async () => {
    await renderGallery();
    const searchInput = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(searchInput, { target: { value: "DevOps" } });
    expect(screen.getByText("DevOps Health Check")).toBeInTheDocument();
    expect(screen.queryByText("Cost Explorer")).not.toBeInTheDocument();
  });

  it("filters configs by search query matching description", async () => {
    await renderGallery();
    const searchInput = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(searchInput, { target: { value: "AWS costs" } });
    expect(screen.getByText("Cost Explorer")).toBeInTheDocument();
    expect(screen.queryByText("DevOps Health Check")).not.toBeInTheDocument();
  });

  it("shows all configs when search query is empty", async () => {
    await renderGallery();
    expect(screen.getByText("Incident Correlation & Root Cause Analysis")).toBeInTheDocument();
    expect(screen.getByText("DevOps Health Check")).toBeInTheDocument();
    expect(screen.getByText("Cost Explorer")).toBeInTheDocument();
  });

  it("filters by category button", async () => {
    await renderGallery();
    const cloudBtn = screen.getByRole("button", { name: "Cloud" });
    fireEvent.click(cloudBtn);
    expect(screen.getByText("Cost Explorer")).toBeInTheDocument();
    expect(screen.queryByText("DevOps Health Check")).not.toBeInTheDocument();
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
    }] as AgentSkill[];
    jest.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    (window.confirm as jest.Mock).mockRestore();
  });

  it("calls deleteSkill when user confirms deletion", async () => {
    await renderGallery();
    const deleteButtons = screen.getAllByTitle("Delete template");
    fireEvent.click(deleteButtons[0]);
    expect(mockDeleteConfig).toHaveBeenCalledWith("qs-del");
  });

  it("does NOT call deleteSkill when user cancels", async () => {
    (window.confirm as jest.Mock).mockReturnValue(false);
    await renderGallery();
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

  it("calls onCreateNew when Skills Builder button is clicked", async () => {
    const onCreateNew = jest.fn();
    await renderGallery({ onCreateNew });
    const btn = screen.getByRole("button", { name: /skills builder/i });
    fireEvent.click(btn);
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Edit/delete visibility (admin vs non-admin, system vs user configs)
// ---------------------------------------------------------------------------

describe("SkillsGallery — edit/delete visibility", () => {
  it("shows edit and delete buttons for non-system configs", async () => {
    _configs = [{
      ...makeQuickStart("user-skill"),
      is_system: false,
      owner_id: "test@example.com",
    }] as AgentSkill[];
    await renderGallery();
    expect(screen.getAllByTitle("Edit template").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Delete template").length).toBeGreaterThan(0);
  });

  it("admin sees edit button on system configs but delete is disabled", async () => {
    mockIsAdmin = true;
    _configs = [makeQuickStart("sys-1")];
    await renderGallery();
    expect(screen.getAllByTitle("Edit template").length).toBeGreaterThan(0);
    expect(screen.queryByTitle("Delete template")).not.toBeInTheDocument();
    expect(screen.getAllByTitle("Built-in skills cannot be deleted").length).toBeGreaterThan(0);
  });

  it("non-admin does NOT see edit on system configs, delete is disabled", async () => {
    mockIsAdmin = false;
    _configs = [makeQuickStart("sys-2")];
    await renderGallery();
    expect(screen.queryByTitle("Edit template")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete template")).not.toBeInTheDocument();
    expect(screen.getAllByTitle("Built-in skills cannot be deleted").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Try Skill flow
// ---------------------------------------------------------------------------

describe("SkillsGallery — Try Skill", () => {
  beforeEach(() => {
    _configs = [{
      ...makeQuickStart("qs-chat"),
      name: "Chat Skill",
      is_system: false,
      owner_id: "test@example.com",
      tasks: [{ display_text: "Do it", llm_prompt: "Perform the task", subagent: "user_input" }],
    }] as AgentSkill[];
  });

  it("calls createConversation, setPendingMessage with 'Lookup skill and use:', and router.push on Try Skill", async () => {
    await renderGallery();
    await act(async () => { fireEvent.click(screen.getByText("Chat Skill")); });
    const tryBtn = screen.getByRole("button", { name: /try skill/i });
    await act(async () => { fireEvent.click(tryBtn); });
    expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    expect(mockSetPendingMessage).toHaveBeenCalledWith(
      "Execute skill: qs-chat\n\nRead and follow the instructions in the SKILL.md file for the \"qs-chat\" skill."
    );
    expect(mockRouterPush).toHaveBeenCalledWith("/chat/conv-abc");
  });

  it("closes the modal after navigation", async () => {
    await renderGallery();
    await act(async () => { fireEvent.click(screen.getByText("Chat Skill")); });
    expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /try skill/i })); });
    expect(screen.queryByRole("button", { name: /try skill/i })).not.toBeInTheDocument();
  });

  it("Try Skill is disabled when supervisor is not synced", async () => {
    mockSupervisorSynced = false;
    await renderGallery();
    await act(async () => { fireEvent.click(screen.getByText("Chat Skill")); });
    const tryBtn = screen.getByRole("button", { name: /try skill/i });
    expect(tryBtn).toBeDisabled();
  });

  it("Try Skill is enabled when supervisor is synced", async () => {
    mockSupervisorSynced = true;
    await renderGallery();
    await act(async () => { fireEvent.click(screen.getByText("Chat Skill")); });
    const tryBtn = screen.getByRole("button", { name: /try skill/i });
    expect(tryBtn).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Template variable parameters
// ---------------------------------------------------------------------------

describe("SkillsGallery — template variable parameters", () => {
  beforeEach(() => {
    _configs = [{
      ...makeQuickStart("qs-vars"),
      name: "Deploy Helper",
      is_system: false,
      owner_id: "test@example.com",
      tasks: [{
        display_text: "Deploy",
        llm_prompt: "Deploy {{app_name}} to {{cluster:prod-us}} with {{replicas:3}} replicas",
        subagent: "user_input",
      }],
    }] as AgentSkill[];
  });

  it("renders parameter input fields for template variables", async () => {
    await renderGallery();
    await act(async () => { fireEvent.click(screen.getByText("Deploy Helper")); });
    expect(screen.getByText("Parameters")).toBeInTheDocument();
    expect(screen.getByText(/App Name/)).toBeInTheDocument();
    expect(screen.getByText(/Cluster/)).toBeInTheDocument();
    expect(screen.getByText(/Replicas/)).toBeInTheDocument();
  });

  it("pre-fills default values for variables with defaults", async () => {
    await renderGallery();
    await act(async () => { fireEvent.click(screen.getByText("Deploy Helper")); });
    const clusterInput = screen.getByDisplayValue("prod-us") as HTMLInputElement;
    expect(clusterInput).toBeInTheDocument();
    const replicasInput = screen.getByDisplayValue("3") as HTMLInputElement;
    expect(replicasInput).toBeInTheDocument();
  });

  it("disables Try Skill when required parameter is empty", async () => {
    await renderGallery();
    await act(async () => { fireEvent.click(screen.getByText("Deploy Helper")); });
    // app_name is required (no default) and starts empty
    const tryBtn = screen.getByRole("button", { name: /try skill/i });
    expect(tryBtn).toBeDisabled();
  });

  it("enables Try Skill when required parameter is filled", async () => {
    await renderGallery();
    await act(async () => { fireEvent.click(screen.getByText("Deploy Helper")); });
    const appInput = screen.getByPlaceholderText(/enter app name/i);
    await act(async () => { fireEvent.change(appInput, { target: { value: "my-service" } }); });
    const tryBtn = screen.getByRole("button", { name: /try skill/i });
    expect(tryBtn).not.toBeDisabled();
  });

  it("sends message with parameters on Try Skill", async () => {
    await renderGallery();
    await act(async () => { fireEvent.click(screen.getByText("Deploy Helper")); });
    const appInput = screen.getByPlaceholderText(/enter app name/i);
    await act(async () => { fireEvent.change(appInput, { target: { value: "my-service" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /try skill/i })); });
    expect(mockSetPendingMessage).toHaveBeenCalledWith(
      "Execute skill: qs-vars\n\nRead and follow the instructions in the SKILL.md file for the \"qs-vars\" skill.\n\nParameters:\n- app_name: my-service\n- cluster: prod-us\n- replicas: 3"
    );
    expect(mockRouterPush).toHaveBeenCalledWith("/chat/conv-abc");
  });

  it("does not render Parameters section for skills without variables", async () => {
    _configs = [{
      ...makeQuickStart("qs-no-vars"),
      name: "Simple Skill",
      is_system: false,
      owner_id: "test@example.com",
      tasks: [{ display_text: "Do it", llm_prompt: "Just do the thing", subagent: "user_input" }],
    }] as AgentSkill[];
    await renderGallery();
    await act(async () => { fireEvent.click(screen.getByText("Simple Skill")); });
    expect(screen.queryByText("Parameters")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// View mode switching
// ---------------------------------------------------------------------------

describe("SkillsGallery — view mode", () => {
  const mySkill: AgentSkill = {
    ...makeQuickStart("my-1"),
    name: "My Personal Skill",
    is_system: false,
    owner_id: "test@example.com",
    visibility: "private",
  } as AgentSkill;

  const globalSkill: AgentSkill = {
    ...makeQuickStart("global-1"),
    name: "Global System Skill",
    is_system: true,
    owner_id: "system",
    visibility: "global",
  } as AgentSkill;

  const teamSkill: AgentSkill = {
    ...makeQuickStart("team-1"),
    name: "Team Shared Skill",
    is_system: false,
    owner_id: "other@example.com",
    visibility: "team",
  } as AgentSkill;

  beforeEach(() => {
    _configs = [mySkill, globalSkill, teamSkill];
  });

  it("My Skills view shows only user-owned non-system configs", async () => {
    await renderGallery();
    const allButtons = screen.getAllByRole("button");
    const mySkillsBtn = allButtons.find(b => b.textContent?.includes("My Skills"));
    fireEvent.click(mySkillsBtn!);
    expect(screen.getByText("My Personal Skill")).toBeInTheDocument();
    expect(screen.queryByText("Global System Skill")).not.toBeInTheDocument();
    expect(screen.queryByText("Team Shared Skill")).not.toBeInTheDocument();
  });

  it("Global view shows configs where visibility=global or is_system", async () => {
    await renderGallery();
    const allButtons = screen.getAllByRole("button");
    const globalBtn = allButtons.find(b => b.textContent?.trim() === "Global");
    fireEvent.click(globalBtn!);
    expect(screen.getByText("Global System Skill")).toBeInTheDocument();
    expect(screen.queryByText("My Personal Skill")).not.toBeInTheDocument();
  });

  it("Workflows view shows only is_quick_start=false configs when flag is on", async () => {
    mockWorkflowRunnerEnabled = true;
    const wf = makeWorkflow("wf-view");
    _configs = [mySkill, wf];
    await renderGallery();
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
  const favSkill: AgentSkill = {
    ...makeQuickStart("fav-1"),
    name: "Favorite Skill",
    is_system: false,
    owner_id: "test@example.com",
  } as AgentSkill;

  it("renders Favorites section when getFavoriteSkills returns configs", async () => {
    _configs = [favSkill];
    mockGetFavoriteConfigs.mockReturnValue([favSkill]);
    mockIsFavorite.mockImplementation((id: string) => id === "fav-1");
    await renderGallery();
    expect(screen.getByText("Favorites")).toBeInTheDocument();
  });

  it("hides Favorites section when empty", async () => {
    _configs = [makeQuickStart()];
    mockGetFavoriteConfigs.mockReturnValue([]);
    await renderGallery();
    expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
  });

  it("clicking the star button calls toggleFavorite", async () => {
    _configs = [{
      ...makeQuickStart("star-1"),
      name: "Star Skill",
      is_system: false,
      owner_id: "test@example.com",
    }] as AgentSkill[];
    await renderGallery();
    const starBtn = screen.getByTitle("Add to favorites");
    fireEvent.click(starBtn);
    expect(mockToggleFavorite).toHaveBeenCalledWith("star-1");
  });
});

// ---------------------------------------------------------------------------
// Loading and error states
// ---------------------------------------------------------------------------

describe("SkillsGallery — loading/error", () => {
  it("renders spinner when isLoading=true", async () => {
    mockIsLoading = true;
    _configs = [];
    await renderGallery();
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("renders error with Try Again button when error is set", async () => {
    mockError = "Failed to load configs";
    _configs = [];
    await renderGallery();
    expect(screen.getByText("Failed to load configs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("Try Again calls loadSkills", async () => {
    mockError = "Network error";
    _configs = [];
    mockLoadConfigs.mockClear();
    await renderGallery();
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
    await renderGallery();
    const searchInput = screen.getByPlaceholderText(/search by name/i);
    fireEvent.change(searchInput, { target: { value: "nonexistent-xyz" } });
    await waitFor(() => {
      expect(screen.getByText(/No skills match your search/)).toBeInTheDocument();
    });
  });

  it("My Skills empty state shows 'Create your first skill' with Skills Builder button", async () => {
    _configs = [makeQuickStart()];
    const onCreateNew = jest.fn();
    await renderGallery({ onCreateNew });
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
// Modal interactions
// ---------------------------------------------------------------------------

describe("SkillsGallery — modal interactions", () => {
  beforeEach(() => {
    _configs = [{
      ...makeQuickStart("qs-modal"),
      name: "Modal Skill",
      is_system: false,
      owner_id: "test@example.com",
    }] as AgentSkill[];
  });

  it("clicking Cancel closes modal", async () => {
    await renderGallery();
    await act(async () => { fireEvent.click(screen.getByText("Modal Skill")); });
    expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();
    const cancelBtns = screen.getAllByRole("button", { name: /cancel/i });
    await act(async () => { fireEvent.click(cancelBtns[0]); });
    expect(screen.queryByRole("button", { name: /try skill/i })).not.toBeInTheDocument();
  });

  it("clicking backdrop closes modal", async () => {
    await renderGallery();
    await act(async () => { fireEvent.click(screen.getByText("Modal Skill")); });
    expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();
    const backdrop = document.querySelector("[class*='fixed inset-0']") as HTMLElement;
    if (backdrop) {
      await act(async () => { fireEvent.click(backdrop); });
    }
    expect(screen.queryByRole("button", { name: /try skill/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Edit config callback
// ---------------------------------------------------------------------------

describe("SkillsGallery — edit callback", () => {
  it("calls onEditConfig for user-owned config when edit button is clicked", async () => {
    const userConfig = {
      ...makeQuickStart("edit-1"),
      name: "Editable Skill",
      is_system: false,
      owner_id: "test@example.com",
    } as AgentSkill;
    _configs = [userConfig];
    const onEditConfig = jest.fn();
    await renderGallery({ onEditConfig });
    const editBtn = screen.getByTitle("Edit template");
    fireEvent.click(editBtn);
    expect(onEditConfig).toHaveBeenCalledTimes(1);
    expect(onEditConfig).toHaveBeenCalledWith(expect.objectContaining({ id: "edit-1" }));
  });

  it("calls onEditConfig for system config when admin clicks edit", async () => {
    mockIsAdmin = true;
    _configs = [makeQuickStart("sys-edit")];
    const onEditConfig = jest.fn();
    await renderGallery({ onEditConfig });
    const editBtn = screen.getByTitle("Edit template");
    fireEvent.click(editBtn);
    expect(onEditConfig).toHaveBeenCalledTimes(1);
    expect(onEditConfig).toHaveBeenCalledWith(expect.objectContaining({ id: "sys-edit" }));
  });
});

// ---------------------------------------------------------------------------
// Workflow card opens modal
// ---------------------------------------------------------------------------

describe("SkillsGallery — workflow card opens modal", () => {
  it("clicking a workflow card opens the modal with Try Skill button", async () => {
    mockWorkflowRunnerEnabled = true;
    _configs = [makeWorkflow("wf-select")];
    await renderGallery();
    const cards = screen.getAllByText("Multi-Step Deploy Workflow");
    await act(async () => { fireEvent.click(cards[0]); });
    expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();
  });
});
