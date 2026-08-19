/**
 * @jest-environment jsdom
 */

import {
  cacheAgentCompletionPreferences,
  deliverAgentCompletionAlert,
  loadAgentCompletionPreferences,
  readCachedAgentCompletionPreferences,
  resetAgentCompletionPreferenceLoad,
  shouldAlertForCurrentPage,
} from "../agent-completion-notifications";

const notifications: MockNotification[] = [];

class MockNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = jest.fn(async () => MockNotification.permission);
  body?: string;
  close = jest.fn();
  onclick: (() => void) | null = null;
  tag?: string;
  title: string;

  constructor(title: string,options?: NotificationOptions) {
    this.title = title;
    this.body = options?.body;
    this.tag = options?.tag;
    notifications.push(this);
  }
}

function jsonResponse(body: unknown,ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

describe("agent completion notifications",() => {
  beforeEach(() => {
    jest.clearAllMocks();
    notifications.length = 0;
    localStorage.clear();
    resetAgentCompletionPreferenceLoad();
    MockNotification.permission = "granted";
    Object.defineProperty(window,"Notification",{
      configurable: true,
      value: MockNotification,
    });
    Object.defineProperty(document,"hidden",{ configurable: true,value: true });
    Object.defineProperty(document,"hasFocus",{
      configurable: true,
      value: jest.fn(() => false),
    });
  });

  it("caches both opt-in preferences",() => {
    cacheAgentCompletionPreferences({ browserEnabled: true,chimeEnabled: false });

    expect(readCachedAgentCompletionPreferences()).toEqual({
      browserEnabled: true,
      chimeEnabled: false,
    });
  });

  it("hydrates preferences from the authenticated settings API",async () => {
    global.fetch = jest.fn(async () => jsonResponse({
      success: true,
      data: {
        notifications: {
          agent_completion_browser_enabled: true,
          agent_completion_chime_enabled: false,
        },
      },
    }));

    await expect(loadAgentCompletionPreferences()).resolves.toEqual({
      browserEnabled: true,
      chimeEnabled: false,
    });
    expect(global.fetch).toHaveBeenCalledWith("/api/settings",{ cache: "no-store" });
  });

  it("alerts only when the page is hidden or unfocused",() => {
    expect(shouldAlertForCurrentPage()).toBe(true);

    Object.defineProperty(document,"hidden",{ configurable: true,value: false });
    Object.defineProperty(document,"hasFocus",{
      configurable: true,
      value: jest.fn(() => true),
    });
    expect(shouldAlertForCurrentPage()).toBe(false);
  });

  it("shows a content-safe browser notification for a background completion",async () => {
    const result = await deliverAgentCompletionAlert(
      {
        agentName: "Example agent",
        conversationId: "conversation-primary",
        messageId: "message-primary",
      },
      {
        preferences: { browserEnabled: true,chimeEnabled: false },
      },
    );

    expect(result).toEqual({ chimePlayed: false,notificationShown: true });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      title: "Example agent finished",
      body: "Your response is ready.",
      tag: "caipe-agent-completion-conversation-primary",
    });
  });

  it("does not interrupt a user who is already looking at CAIPE",async () => {
    Object.defineProperty(document,"hidden",{ configurable: true,value: false });
    Object.defineProperty(document,"hasFocus",{
      configurable: true,
      value: jest.fn(() => true),
    });

    const result = await deliverAgentCompletionAlert(
      {
        conversationId: "conversation-primary",
        messageId: "message-primary",
      },
      {
        preferences: { browserEnabled: true,chimeEnabled: false },
      },
    );

    expect(result.notificationShown).toBe(false);
    expect(notifications).toHaveLength(0);
  });
});
