/**
 * @jest-environment jsdom
 */

import { getDefaultNewChatAgentId, resolveNewConversationAgentId } from "../new-chat-agent";

describe("new chat agent resolution", () => {
  beforeEach(() => {
    delete (window as unknown as { __APP_CONFIG__?: unknown }).__APP_CONFIG__;
  });

  it("uses DEFAULT_NEW_CHAT_AGENT_ID when no agent id is provided", () => {
    (window as unknown as { __APP_CONFIG__?: unknown }).__APP_CONFIG__ = {
      dynamicAgentsEnabled: true,
      defaultNewChatAgentId: "agent-sunny-webex-meeting-test",
    };

    expect(getDefaultNewChatAgentId()).toBe("agent-sunny-webex-meeting-test");
    expect(resolveNewConversationAgentId()).toBe("agent-sunny-webex-meeting-test");
  });

  it("does not use the default when dynamic agents are disabled", () => {
    (window as unknown as { __APP_CONFIG__?: unknown }).__APP_CONFIG__ = {
      dynamicAgentsEnabled: false,
      defaultNewChatAgentId: "agent-sunny-webex-meeting-test",
    };

    expect(getDefaultNewChatAgentId()).toBeUndefined();
    expect(resolveNewConversationAgentId()).toBeUndefined();
  });

  it("preserves explicit agent selection", () => {
    (window as unknown as { __APP_CONFIG__?: unknown }).__APP_CONFIG__ = {
      dynamicAgentsEnabled: true,
      defaultNewChatAgentId: "agent-sunny-webex-meeting-test",
    };

    expect(resolveNewConversationAgentId("agent-other")).toBe("agent-other");
  });

  it("treats null as explicit Platform Engineer selection", () => {
    (window as unknown as { __APP_CONFIG__?: unknown }).__APP_CONFIG__ = {
      dynamicAgentsEnabled: true,
      defaultNewChatAgentId: "agent-sunny-webex-meeting-test",
    };

    expect(resolveNewConversationAgentId(null)).toBeUndefined();
  });
});
