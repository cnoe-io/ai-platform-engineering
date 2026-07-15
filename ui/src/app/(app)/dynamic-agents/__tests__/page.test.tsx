import React from "react";
import { fireEvent,render,screen } from "@testing-library/react";

// assisted-by Codex Codex-sonnet-4-6

let mockIsAdmin = false;
let mockAdminTabGates = { audit_logs: false, dynamic_agent_conversations: false };
let mockSearchParams = new URLSearchParams();
const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("@/hooks/use-admin-role", () => ({
  useAdminRole: () => ({ isAdmin: mockIsAdmin, loading: false }),
}));

jest.mock("@/hooks/useAdminTabGates", () => ({
  useAdminTabGates: () => ({ gates: mockAdminTabGates, loading: false, error: null }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => "/dynamic-agents",
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/components/auth-guard", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/dynamic-agents/DynamicAgentsTab", () => ({
  DynamicAgentsTab: ({
    selectedAgentId,
    initialStep,
    onSelectedAgentChange,
    onStepChange,
  }: {
    selectedAgentId?: string | null;
    initialStep?: string;
    onSelectedAgentChange?: (id: string | null) => void;
    onStepChange?: (step: string) => void;
  }) => (
    <div
      data-testid="dynamic-agents-tab"
      data-selected-id={selectedAgentId ?? ""}
      data-step={initialStep ?? ""}
    >
      DynamicAgentsTab
      <button type="button" onClick={() => onStepChange?.("tools")}>
        Open tools step
      </button>
      <button type="button" onClick={() => onSelectedAgentChange?.("agent-ops")}>
        Open agent editor
      </button>
    </div>
  ),
}));

jest.mock("@/components/dynamic-agents/MCPServersTab", () => ({
  MCPServersTab: ({
    selectedServerId,
    onSelectedServerChange,
  }: {
    selectedServerId?: string | null;
    onSelectedServerChange?: (id: string | null) => void;
  }) => (
    <div data-testid="mcp-servers-tab" data-selected-id={selectedServerId ?? ""}>
      MCPServersTab
      <button type="button" onClick={() => onSelectedServerChange?.("mcp-jira")}>
        Open server editor
      </button>
    </div>
  ),
}));

jest.mock("@/components/dynamic-agents/LLMProvidersTab", () => ({
  LLMProvidersTab: ({
    selectedModelId,
    onSelectedModelChange,
  }: {
    selectedModelId?: string | null;
    onSelectedModelChange?: (id: string | null) => void;
  }) => (
    <div data-testid="llm-models-tab" data-selected-id={selectedModelId ?? ""}>
      LLMProvidersTab
      <button type="button" onClick={() => onSelectedModelChange?.("openai/gpt-4o")}>
        Open model editor
      </button>
    </div>
  ),
}));

jest.mock("@/components/dynamic-agents/ConversationsTab", () => ({
  ConversationsTab: () => <div data-testid="conversations-tab">ConversationsTab</div>,
}));

jest.mock("@/store/unsaved-changes-store", () => ({
  useUnsavedChangesStore: Object.assign(
    () => ({ hasUnsavedChanges: false }),
    {
      getState: () => ({
        hasUnsavedChanges: false,
        setUnsaved: jest.fn(),
      }),
    }
  ),
}));

jest.mock("@/components/shared/UnsavedChangesDialog", () => ({
  UnsavedChangesDialog: () => null,
}));

import DynamicAgentsPage from "../page";

describe("DynamicAgentsPage", () => {
  beforeEach(() => {
    mockIsAdmin = false;
    mockAdminTabGates = { audit_logs: false, dynamic_agent_conversations: false };
    mockSearchParams = new URLSearchParams();
    mockPush.mockClear();
    mockReplace.mockClear();
  });

  it("renders the OpenFGA-filtered Agents surface for non-admin users", () => {
    render(<DynamicAgentsPage />);

    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Agents$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^MCP Servers$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^LLM Models$/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Conversations$/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("conversations-tab")).not.toBeInTheDocument();
    expect(screen.queryByText("Access Denied")).not.toBeInTheDocument();
  });

  it("falls back to Agents when a hidden Conversations deep link is requested", () => {
    mockSearchParams = new URLSearchParams("tab=conversations");

    render(<DynamicAgentsPage />);

    expect(screen.getByTestId("dynamic-agents-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("conversations-tab")).not.toBeInTheDocument();
  });

  it("shows Conversations for admins with Dynamic Agent conversation access", () => {
    mockIsAdmin = true;
    mockAdminTabGates = { audit_logs: false, dynamic_agent_conversations: true };

    render(<DynamicAgentsPage />);

    expect(screen.getByRole("tab", { name: /^Conversations$/i })).toBeInTheDocument();
  });

  it("allows OpenFGA-authorized users to deep link to Conversations", () => {
    mockIsAdmin = true;
    mockAdminTabGates = { audit_logs: false, dynamic_agent_conversations: true };
    mockSearchParams = new URLSearchParams("tab=conversations");

    render(<DynamicAgentsPage />);

    expect(screen.getByTestId("conversations-tab")).toBeInTheDocument();
  });

  it("passes an agent deep link and setup step into the editor surface", () => {
    mockSearchParams = new URLSearchParams("tab=agents&agent=agent-ops&step=instructions");

    render(<DynamicAgentsPage />);

    expect(screen.getByTestId("dynamic-agents-tab")).toHaveAttribute("data-selected-id", "agent-ops");
    expect(screen.getByTestId("dynamic-agents-tab")).toHaveAttribute("data-step", "instructions");
  });

  it("updates the current agent setup step in the URL", () => {
    mockSearchParams = new URLSearchParams("tab=agents&agent=agent-ops&step=basic");

    render(<DynamicAgentsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open tools step" }));

    expect(mockReplace).toHaveBeenCalledWith(
      "/dynamic-agents?tab=agents&agent=agent-ops&step=tools",
    );
  });

  it.each([
    ["mcp-servers", "server", "mcp-jira", "mcp-servers-tab"],
    ["llm-models", "model", "openai/gpt-4o", "llm-models-tab"],
  ])("passes a selected %s resource from the URL", (tab, key, id, testId) => {
    const params = new URLSearchParams({ tab, [key]: id });
    mockSearchParams = params;

    render(<DynamicAgentsPage />);

    expect(screen.getByTestId(testId)).toHaveAttribute("data-selected-id", id);
  });

  it.each([
    ["agents", "Open agent editor", "/dynamic-agents?tab=agents&agent=agent-ops&step=basic"],
    ["mcp-servers", "Open server editor", "/dynamic-agents?tab=mcp-servers&server=mcp-jira"],
    ["llm-models", "Open model editor", "/dynamic-agents?tab=llm-models&model=openai%2Fgpt-4o"],
  ])("adds the selected %s resource to the URL", (tab, buttonName, expectedHref) => {
    mockSearchParams = new URLSearchParams({ tab });
    render(<DynamicAgentsPage />);

    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    expect(mockPush).toHaveBeenCalledWith(expectedHref);
  });

  it("clears resource and setup parameters when switching top-level tabs", () => {
    mockSearchParams = new URLSearchParams("tab=agents&agent=agent-ops&step=advanced");
    render(<DynamicAgentsPage />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "MCP Servers" }), {
      button: 0,
      ctrlKey: false,
    });

    expect(mockPush).toHaveBeenCalledWith("/dynamic-agents?tab=mcp-servers");
  });
});
