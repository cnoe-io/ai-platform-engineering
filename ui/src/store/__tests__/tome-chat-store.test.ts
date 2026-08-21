import {
  emptyTomeChatViewState,
  selectTomeActiveStreamCount,
  tomeChatKey,
  useTomeChatStore,
} from "@/store/tome-chat-store";

describe("tome chat store", () => {
  beforeEach(() => {
    useTomeChatStore.getState().reset();
  });

  it("keeps an in-flight turn in app-level state", () => {
    const key = tomeChatKey("example-project");
    useTomeChatStore.getState().updateChat(key, (chat) => ({
      ...chat,
      hydrated: true,
      streaming: true,
      messages: [
        {
          id: "user-message",
          role: "user",
          parts: [{ kind: "text", text: "Summarize the project" }],
        },
        {
          id: "assistant-message",
          role: "assistant",
          parts: [{ kind: "text", text: "Working" }],
          pending: true,
        },
      ],
    }));

    // A new ChatPanel instance reads the same state after route/view changes.
    const restored = useTomeChatStore.getState().chats[key];
    expect(restored.streaming).toBe(true);
    expect(restored.messages[1].parts).toEqual([
      { kind: "text", text: "Working" },
    ]);
    expect(selectTomeActiveStreamCount(useTomeChatStore.getState())).toBe(1);
  });

  it("does not let a late history response overwrite a live turn", () => {
    const key = tomeChatKey("example-project");
    useTomeChatStore.getState().updateChat(key, (chat) => ({
      ...chat,
      streaming: true,
      messages: [
        {
          id: "assistant-message",
          role: "assistant",
          parts: [{ kind: "text", text: "Live response" }],
          pending: true,
        },
      ],
    }));

    useTomeChatStore.getState().hydrateChat(key, {
      ...emptyTomeChatViewState(),
      hydrated: true,
      messages: [],
      sessionId: "history-session",
    });

    const restored = useTomeChatStore.getState().chats[key];
    expect(restored.streaming).toBe(true);
    expect(restored.hydrated).toBe(true);
    expect(restored.messages).toHaveLength(1);
    expect(restored.messages[0].parts).toEqual([
      { kind: "text", text: "Live response" },
    ]);
  });

  it("tracks streams independently per project", () => {
    for (const slug of ["primary", "secondary"]) {
      useTomeChatStore.getState().updateChat(tomeChatKey(slug), (chat) => ({
        ...chat,
        streaming: true,
      }));
    }

    expect(selectTomeActiveStreamCount(useTomeChatStore.getState())).toBe(2);

    useTomeChatStore
      .getState()
      .updateChat(tomeChatKey("primary"), (chat) => ({ ...chat, streaming: false }));

    expect(selectTomeActiveStreamCount(useTomeChatStore.getState())).toBe(1);
  });
});
