/**
 * @jest-environment jsdom
 */

import { resolveNewConversationAgentId } from "../new-chat-agent";

describe("new chat agent resolution", () => {
  const mockFetch = global.fetch as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as unknown as { __APP_CONFIG__?: unknown }).__APP_CONFIG__;
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true, data: { default_agent_id: null } }),
    });
  });

  it("uses the platform-config default when no agent id is provided", async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, data: { default_agent_id: "agent-platform-default" } }),
    });

    await expect(resolveNewConversationAgentId()).resolves.toBe("agent-platform-default");
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/platform-config");
  });

  it("falls back to supervisor when no platform default is configured", async () => {
    await expect(resolveNewConversationAgentId()).resolves.toBeUndefined();
  });

  it("preserves explicit agent selection", async () => {
    await expect(resolveNewConversationAgentId("agent-other")).resolves.toBe("agent-other");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("treats null as explicit Platform Engineer selection", async () => {
    await expect(resolveNewConversationAgentId(null)).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
