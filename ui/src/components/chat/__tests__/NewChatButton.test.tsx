import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("@/lib/gradient-themes", () => ({
  getGradientStyle: jest.fn(() => null),
  getAccentColor: jest.fn(() => "white"),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock("lucide-react", () => ({
  Plus: () => <span data-testid="plus-icon" />,
  ChevronDown: () => <span data-testid="chevron-icon" />,
  Bot: () => <span data-testid="bot-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
  Search: () => <span data-testid="search-icon" />,
}));

const mockFetch = jest.fn();

import { NewChatButton } from "../NewChatButton";

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
});

/**
 * Route fetch by URL so tests are robust to the parallel
 * preferences + platform-config resolution. `prefsAgentId` is the user's
 * personal web default (null → none); `platformAgentId` is the admin default.
 * `agentNames` maps agent id → display name for the detail lookup.
 */
function mockFetchByUrl(opts: {
  prefsAgentId?: string | null;
  platformAgentId?: string | null;
  agentNames?: Record<string, string>;
  prefsPromise?: Promise<Response>;
}) {
  const { prefsAgentId = null, platformAgentId = null, agentNames = {} } = opts;
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/user/preferences") {
      if (opts.prefsPromise) return opts.prefsPromise;
      return Promise.resolve({
        json: async () => ({ success: true, data: { web_default_agent_id: prefsAgentId } }),
      } as Response);
    }
    if (url === "/api/admin/platform-config") {
      return Promise.resolve({
        json: async () => ({ success: true, data: { default_agent_id: platformAgentId } }),
      } as Response);
    }
    const match = url.match(/^\/api\/dynamic-agents\/agents\/(.+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { _id: id, name: agentNames[id] ?? id } }),
      } as Response);
    }
    return Promise.resolve({ ok: false, json: async () => ({ success: false }) } as Response);
  });
}

describe("NewChatButton", () => {
  it("waits for default-agent resolution before creating a new chat", async () => {
    let resolvePrefs: (value: Response) => void = () => {};
    mockFetchByUrl({
      platformAgentId: "agent-default",
      prefsPromise: new Promise<Response>((resolve) => {
        resolvePrefs = resolve;
      }),
    });
    const onNewChat = jest.fn();

    render(<NewChatButton collapsed={false} onNewChat={onNewChat} />);

    const mainButton = screen.getByRole("button", { name: /new chat/i });
    expect(mainButton).toBeDisabled();
    fireEvent.click(mainButton);
    expect(onNewChat).not.toHaveBeenCalled();

    resolvePrefs({
      json: async () => ({ success: true, data: { web_default_agent_id: null } }),
    } as Response);

    await waitFor(() => expect(mainButton).not.toBeDisabled());
    fireEvent.click(mainButton);

    expect(onNewChat).toHaveBeenCalledWith("agent-default");
  });

  it("shows the configured default agent name once it can resolve the agent", async () => {
    mockFetchByUrl({
      platformAgentId: "agent-default",
      agentNames: { "agent-default": "Platform Helper" },
    });

    render(<NewChatButton collapsed={false} onNewChat={jest.fn()} />);

    expect(await screen.findByText("Platform Helper")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith("/api/dynamic-agents/agents/agent-default");
  });

  it("prefers the user's web default over the platform default", async () => {
    mockFetchByUrl({
      prefsAgentId: "agent-user",
      platformAgentId: "agent-default",
      agentNames: { "agent-user": "My Agent", "agent-default": "Platform Helper" },
    });
    const onNewChat = jest.fn();

    render(<NewChatButton collapsed={false} onNewChat={onNewChat} />);

    expect(await screen.findByText("My Agent")).toBeInTheDocument();
    const mainButton = screen.getByRole("button", { name: /my agent/i });
    fireEvent.click(mainButton);
    expect(onNewChat).toHaveBeenCalledWith("agent-user");
  });

  it("calls onNewChat with undefined when no default agent is configured", async () => {
    mockFetchByUrl({ prefsAgentId: null, platformAgentId: null });
    const onNewChat = jest.fn();

    render(<NewChatButton collapsed={false} onNewChat={onNewChat} />);

    const mainButton = screen.getByRole("button", { name: /new chat/i });
    await waitFor(() => expect(mainButton).not.toBeDisabled());
    fireEvent.click(mainButton);

    expect(onNewChat).toHaveBeenCalledWith(undefined);
  });
});
