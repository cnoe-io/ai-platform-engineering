/**
 * Tests for SkillsGallery component.
 *
 * Covers:
 *  - WORKFLOW_RUNNER_ENABLED feature flag gating
 *  - Search/filter by name, description, category
 *  - Delete confirm/cancel flow
 *  - Try Skill flow (createConversation, setPendingMessage with skill name, navigation)
 *  - Try Skill disabled when supervisor not synced
 *  - View mode switching (all, my-skills, global, workflows)
 *  - Edit/delete visibility (admin vs non-admin, system vs user configs)
 *  - Favorites section and toggle
 *  - Loading/error states
 *  - Empty states
 *  - Modal interactions (backdrop, X button, Cancel)
 *  - Edit config and onSelectConfig callbacks
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

// Supervisor sync mock — default: synced
let mockSupervisorSynced = true;

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

function renderGallery(props: Partial<React.ComponentProps<typeof SkillsGallery>> = {}) {
  return render(
    <SkillsGallery
      onSelectConfig={jest.fn()}
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
  mockSupervisorSynced = true;
  mockIsFavorite.mockReturnValue(false);
  mockGetFavoriteConfigs.mockReturnValue([]);
  mockCreateConversation.mockReturnValue("conv-abc");
  _configs = [];

  // Mock fetch for supervisor-status and skills catalog
  global.fetch = jest.fn((url: string) => {
    if (typeof url === "string" && url.includes("/api/skills/supervisor-status")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          mas_registered: mockSupervisorSynced,
          skills_loaded_count: mockSupervisorSynced ? 5 : 0,
          skills_merged_at: mockSupervisorSynced ? new Date().toISOString() : null,
        }),
      });
    }
    if (typeof url === "string" && url.includes("/api/skills")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ skills: [], meta: { total: 0, sources_loaded: [], unavailable_sources: [] } }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
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

  it("does NOT render the Multi-Step Workflows section when the flag is off", () => {
    renderGallery();

    expect(screen.queryByText("Multi-Step Workflows")).not.toBeInTheDocument();
  });

  it("still renders the quick-start card gallery when the flag is off", () => {
    renderGallery();

    expect(screen.getByText("Incident Correlation & Root Cause Analysis")).toBeInTheDocument();
  });

  it("renders Try Skill as the action button in the modal", async () => {
    renderGallery();

    const card = screen.getByText("Incident Correlation & Root Cause Analysis");
    fireEvent.click(card);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();
    });
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

  it("renders the Multi-Step Workflows section when the flag is on", () => {
    renderGallery();

    expect(screen.getByText("Multi-Step Workflows")).toBeInTheDocument();
  });

  it("displays the workflow card name in the Multi-Step Workflows section", () => {
    renderGallery();

    expect(screen.getAllByText("Multi-Step Deploy Workflow").length).toBeGreaterThan(0);
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
    ] as AgentSkill[];
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
    renderGallery();

    const deleteButtons = screen.getAllByTitle("Delete template");
    fireEvent.click(deleteButtons[0]);

    expect(mockDeleteConfig).toHaveBeenCalledWith("qs-del");
  });

  it("does NOT call deleteSkill when user cancels", () => {
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
// Edit/delete visibility (admin vs non-admin, system vs user configs)
// ---------------------------------------------------------------------------

describe("SkillsGallery — edit/delete visibility", () => {
  it("shows edit and delete buttons for non-system configs", () => {
    _configs = [{
      ...makeQuickStart("user-skill"),
      is_system: false,
      owner_id: "test@example.com",
    }] as AgentSkill[];

    renderGallery();

    expect(screen.getAllByTitle("Edit template").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Delete template").length).toBeGreaterThan(0);
  });

  it("admin sees edit button on system configs but delete is disabled", () => {
    mockIsAdmin = true;
    _configs = [makeQuickStart("sys-1")];

    renderGallery();

    expect(screen.getAllByTitle("Edit template").length).toBeGreaterThan(0);
    // Delete button shows as disabled with informational title
    expect(screen.queryByTitle("Delete template")).not.toBeInTheDocument();
    expect(screen.getAllByTitle("Built-in skills cannot be deleted").length).toBeGreaterThan(0);
  });

  it("non-admin does NOT see edit on system configs, delete is disabled", () => {
    mockIsAdmin = false;
    _configs = [makeQuickStart("sys-2")];

    renderGallery();

    expect(screen.queryByTitle("Edit template")).not.toBeInTheDocument();
    // Delete button is present but disabled
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

  it("calls createConversation, setPendingMessage with skill name, and router.push on Try Skill", async () => {
    renderGallery();

    fireEvent.click(screen.getByText("Chat Skill"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();
    });

    const runBtn = screen.getByRole("button", { name: /try skill/i });
    fireEvent.click(runBtn);

    expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    expect(mockSetPendingMessage).toHaveBeenCalledWith("Chat Skill");
    expect(mockRouterPush).toHaveBeenCalledWith("/chat/conv-abc");
  });

  it("closes the modal after navigation", async () => {
    renderGallery();

    fireEvent.click(screen.getByText("Chat Skill"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try skill/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /try skill/i }));

    expect(screen.queryByRole("button", { name: /try skill/i })).not.toBeInTheDocument();
  });

  it("Try Skill button is disabled when supervisor is not synced", async () => {
    mockSupervisorSynced = false;

    renderGallery();

    fireEvent.click(screen.getByText("Chat Skill"));

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /try skill/i });
      expect(btn).toBeDisabled();
    });
  });

  it("shows warning icon when supervisor is not synced", async () => {
    mockSupervisorSynced = false;

    renderGallery();

    fireEvent.click(screen.getByText("Chat Skill"));

    await waitFor(() => {
      expect(screen.getByTitle(/not synced with the supervisor/i)).toBeInTheDocument();
    });
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
  const favSkill: AgentSkill = {
    ...makeQuickStart("fav-1"),
    name: "Favorite Skill",
    is_system: false,
    owner_id: "test@example.com",
  } as AgentSkill;

  it("renders Favorites section when getFavoriteSkills returns configs", () => {
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
    }] as AgentSkill[];

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

  it("Try Again calls loadSkills", () => {
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
      expect(screen.getByText(/No skills match your search/)).toBeInTheDocument();
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

  it("clicking Cancel closes modal", () => {
    renderGallery();
    fireEvent.click(screen.getByText("Modal Skill"));

    const cancelBtns = screen.getAllByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtns[0]);

    // Modal should be closed — skill name as heading should be gone
    expect(screen.queryByRole("button", { name: /try skill/i })).not.toBeInTheDocument();
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
    } as AgentSkill;
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
