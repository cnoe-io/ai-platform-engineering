import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockGetConfig = jest.fn((key: string) => {
  if (key === "dynamicAgentsEnabled") return true;
  return undefined;
});

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => mockGetConfig(key),
}));

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
  mockGetConfig.mockImplementation((key: string) => {
    if (key === "dynamicAgentsEnabled") return true;
    return undefined;
  });
});

describe("NewChatButton", () => {
  it("waits for default-agent resolution before creating a new chat", async () => {
    let resolvePlatformConfig: (value: Response) => void = () => {};
    mockFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolvePlatformConfig = resolve;
      }),
    );
    const onNewChat = jest.fn();

    render(<NewChatButton collapsed={false} onNewChat={onNewChat} />);

    const mainButton = screen.getByRole("button", { name: /new chat/i });
    expect(mainButton).toBeDisabled();
    fireEvent.click(mainButton);
    expect(onNewChat).not.toHaveBeenCalled();

    resolvePlatformConfig({
      json: async () => ({ success: true, data: { default_agent_id: "agent-default" } }),
    } as Response);

    await waitFor(() => expect(mainButton).not.toBeDisabled());
    fireEvent.click(mainButton);

    expect(onNewChat).toHaveBeenCalledWith("agent-default");
  });

  it("shows the configured default agent name once it can resolve the agent", async () => {
    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({ success: true, data: { default_agent_id: "agent-default" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { _id: "agent-default", name: "Platform Helper" },
        }),
      });

    render(<NewChatButton collapsed={false} onNewChat={jest.fn()} />);

    expect(await screen.findByText("Platform Helper")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/dynamic-agents/agents/agent-default");
  });

  it("falls back to supervisor chat when no default agent is configured", async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, data: { default_agent_id: null } }),
    });
    const onNewChat = jest.fn();

    render(<NewChatButton collapsed={false} onNewChat={onNewChat} />);

    const mainButton = screen.getByRole("button", { name: /new chat/i });
    await waitFor(() => expect(mainButton).not.toBeDisabled());
    fireEvent.click(mainButton);

    expect(onNewChat).toHaveBeenCalledWith(null);
  });
});
