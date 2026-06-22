import React from "react";
import { render, screen } from "@testing-library/react";

// assisted-by Codex Codex-sonnet-4-6

let mockIsAdmin = false;
let mockAdminTabGates = { audit_logs: false, dynamic_agent_conversations: false };
let mockSearchParams = new URLSearchParams();

jest.mock("@/hooks/use-admin-role", () => ({
  useAdminRole: () => ({ isAdmin: mockIsAdmin, loading: false }),
}));

jest.mock("@/hooks/useAdminTabGates", () => ({
  useAdminTabGates: () => ({ gates: mockAdminTabGates, loading: false, error: null }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
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
  DynamicAgentsTab: () => <div data-testid="dynamic-agents-tab">DynamicAgentsTab</div>,
}));

jest.mock("@/components/dynamic-agents/MCPServersTab", () => ({
  MCPServersTab: () => <div data-testid="mcp-servers-tab">MCPServersTab</div>,
}));

jest.mock("@/components/dynamic-agents/LLMProvidersTab", () => ({
  LLMProvidersTab: () => <div data-testid="llm-models-tab">LLMProvidersTab</div>,
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

jest.mock("@/components/task-builder/UnsavedChangesDialog", () => ({
  UnsavedChangesDialog: () => null,
}));

import DynamicAgentsPage from "../page";

describe("DynamicAgentsPage", () => {
  beforeEach(() => {
    mockIsAdmin = false;
    mockAdminTabGates = { audit_logs: false, dynamic_agent_conversations: false };
    mockSearchParams = new URLSearchParams();
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
});
