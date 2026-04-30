/**
 * Tests for SkillsGallery component.
 *
 * Covers:
 *  - WORKFLOW_RUNNER_ENABLED feature flag gating
 *  - Search/filter by name, description, category
 *  - Delete confirm/cancel flow
 *  - Try Skill flow (createConversation, setPendingMessage, navigation)
 *  - View mode switching (all, my-skills, team, global)
 *  - Edit/delete visibility (admin vs non-admin, system vs user configs)
 *  - Favorites section and toggle
 *  - Loading/error states
 *  - Empty states
 *  - Modal interactions (backdrop, X button, Cancel)
 *  - Edit config and onSelectConfig callbacks
 *  - Supervisor sync gating (Try Skill disabled when not synced)
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
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

// `SkillFolderViewer` (used by gallery's view-files dialog) imports
// react-markdown / remark-gfm which ship as ESM and aren't in the Jest
// transformIgnorePatterns allowlist. Mock them out — these tests don't
// exercise the viewer's markdown rendering.
jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("remark-gfm", () => ({
  __esModule: true,
  default: () => {},
}));

jest.mock("@/components/ui/caipe-spinner", () => ({
  CAIPESpinner: ({ message }: any) => <div data-testid="spinner">{message}</div>,
}));

jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
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
    name: "Deploy Pipeline Workflow",
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

  it("opens modal and shows Try Skill button when clicking a quick-start card", async () => {
    await renderGallery();
    const card = screen.getByText("Incident Correlation & Root Cause Analysis");
    await act(async () => { fireEvent.click(card); });
    expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();
  });

  it("displays multi-task workflow in the main Skills grid", async () => {
    await renderGallery();
    expect(screen.getAllByRole("heading", { name: "Skills" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Deploy Pipeline Workflow").length).toBeGreaterThan(0);
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
    const searchInput = screen.getByPlaceholderText(/search name/i);
    fireEvent.change(searchInput, { target: { value: "DevOps" } });
    expect(screen.getByText("DevOps Health Check")).toBeInTheDocument();
    expect(screen.queryByText("Cost Explorer")).not.toBeInTheDocument();
  });

  it("filters configs by search query matching description", async () => {
    await renderGallery();
    const searchInput = screen.getByPlaceholderText(/search name/i);
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

  it("filters by category picker", async () => {
    await renderGallery();
    fireEvent.click(screen.getByRole("button", { name: /category filter/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cloud" }));
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
  });

  // Delete now uses a UI Dialog confirmation (not the browser confirm()),
  // so these tests exercise the dialog's Delete / Cancel buttons.

  it("calls deleteSkill when user confirms deletion in the dialog", async () => {
    await renderGallery();
    const deleteButtons = screen.getAllByTitle("Delete");
    fireEvent.click(deleteButtons[0]);
    // Dialog opens; click the destructive "Delete" button inside it. The
    // built-in template variant uses "Remove" so we accept either.
    const confirmBtn = await screen.findByRole("button", {
      name: /^(Delete|Remove)$/,
    });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(mockDeleteConfig).toHaveBeenCalledWith("qs-del");
    });
  });

  it("does NOT call deleteSkill when user cancels the dialog", async () => {
    await renderGallery();
    const deleteButtons = screen.getAllByTitle("Delete");
    fireEvent.click(deleteButtons[0]);
    const cancelBtn = await screen.findByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);
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

  it("calls onCreateNew when Skill Builder button is clicked", async () => {
    const onCreateNew = jest.fn();
    await renderGallery({ onCreateNew });
    const btn = screen.getByRole("button", { name: /skill builder/i });
    fireEvent.click(btn);
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Edit/delete visibility (Mongo rows vs catalog-only merge entries)
// ---------------------------------------------------------------------------

describe("SkillsGallery — source filter (built-in vs custom)", () => {
  it("shows only user Mongo skills under Custom and only is_system under Built-in", async () => {
    const userSkill = {
      ...makeQuickStart("user-owned-1"),
      name: "My Custom Only Skill",
      is_system: false,
      owner_id: "test@example.com",
    } as AgentSkill;
    _configs = [makeQuickStart("builtin-1"), userSkill];
    await renderGallery();

    const sourceGroup = screen.getByRole("group", { name: /filter by skill source/i });

    await act(async () => {
      fireEvent.click(within(sourceGroup).getByRole("button", { name: "Custom" }));
    });
    expect(screen.getByText("My Custom Only Skill")).toBeInTheDocument();
    expect(screen.queryByText("Incident Correlation & Root Cause Analysis")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(sourceGroup).getByRole("button", { name: "Built-in" }));
    });
    expect(screen.getByText("Incident Correlation & Root Cause Analysis")).toBeInTheDocument();
    expect(screen.queryByText("My Custom Only Skill")).not.toBeInTheDocument();
  });
});

describe("SkillsGallery — edit/delete visibility", () => {
  it("shows edit and delete buttons for non-system configs", async () => {
    _configs = [{
      ...makeQuickStart("user-skill"),
      is_system: false,
      owner_id: "test@example.com",
    }] as AgentSkill[];
    await renderGallery();
    expect(screen.getAllByTitle("Edit").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Delete").length).toBeGreaterThan(0);
  });

  it("shows edit and delete for built-in Mongo configs (non-admin)", async () => {
    mockIsAdmin = false;
    _configs = [makeQuickStart("sys-1")];
    await renderGallery();
    expect(screen.getAllByTitle("Edit").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Delete").length).toBeGreaterThan(0);
  });

  it("disables delete for catalog-only merge entries", async () => {
    mockIsAdmin = false;
    _configs = [
      {
        ...makeQuickStart("catalog-x"),
        id: "catalog-hub-1",
        is_system: true,
      } as AgentSkill,
    ];
    await renderGallery();
    // Hub-crawled rows now route through `renderRowActions`'s hub branch:
    // the trash button is disabled with a "Crawled from GitHub" explanation
    // and the edit pencil is replaced by a read-only Eye view button.
    expect(
      screen.getAllByTitle(/Crawled from GitHub/i).length
    ).toBeGreaterThan(0);
    expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();
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

  it("All view lists quick-start and multi-task skills together", async () => {
    mockWorkflowRunnerEnabled = true;
    const wf = makeWorkflow("wf-view");
    _configs = [mySkill, wf];
    await renderGallery();
    expect(screen.getByText("Deploy Pipeline Workflow")).toBeInTheDocument();
    expect(screen.getByText("My Personal Skill")).toBeInTheDocument();
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
    const searchInput = screen.getByPlaceholderText(/search name/i);
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
    expect(screen.getAllByRole("button", { name: /skills builder/i }).length).toBeGreaterThan(0);
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
    const editBtn = screen.getByTitle("Edit");
    fireEvent.click(editBtn);
    expect(onEditConfig).toHaveBeenCalledTimes(1);
    expect(onEditConfig).toHaveBeenCalledWith(expect.objectContaining({ id: "edit-1" }));
  });

  it("calls onEditConfig for system config when any user clicks edit", async () => {
    mockIsAdmin = false;
    _configs = [makeQuickStart("sys-edit")];
    const onEditConfig = jest.fn();
    await renderGallery({ onEditConfig });
    const editBtn = screen.getByTitle("Edit");
    fireEvent.click(editBtn);
    expect(onEditConfig).toHaveBeenCalledTimes(1);
    expect(onEditConfig).toHaveBeenCalledWith(expect.objectContaining({ id: "sys-edit" }));
  });
});

// ---------------------------------------------------------------------------
// Multi-task skill card opens modal
// ---------------------------------------------------------------------------

describe("SkillsGallery — multi-task skill card opens modal", () => {
  it("clicking a workflow card opens the modal with Try Skill button", async () => {
    mockWorkflowRunnerEnabled = true;
    _configs = [makeWorkflow("wf-select")];
    await renderGallery();
    const cards = screen.getAllByText("Deploy Pipeline Workflow");
    await act(async () => { fireEvent.click(cards[0]); });
    expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();
  });
});
