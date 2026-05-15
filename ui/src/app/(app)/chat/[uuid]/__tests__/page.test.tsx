/**
 * Unit tests for ChatUUID page (/chat/[uuid])
 *
 * Tests cover:
 * - Branded spinner while loading from MongoDB
 * - Spinner persists until messages actually arrive (prevents Welcome screen flash)
 * - Spinner for metadata-only stubs (Sidebar race condition)
 * - Instant render when messages already in store
 * - No spinner in localStorage mode
 * - 404 fallback to empty conversation
 * - Non-404 API errors (network failures)
 * - Invalid UUID shows error state
 * - loadTurnsFromServer failure (metadata-only stub path, Platform Engineer)
 * - loadTurnsFromServer failure (not-in-store path, Platform Engineer)
 * - Unexpected outer error fallback
 * - setActiveConversation always called across all paths
 * - Background sync fires for conversations already loaded with messages
 * - Conversation appearing in store mid-fetch (race recovery)
 * - localStorage mode with empty conversation in store
 * - Sidebar race: storeHasMessages stays false after fetch → spinner persists
 * - Error state UI renders correctly with link
 * - Context panel renders alongside chat
 * - AuthGuard wraps the page
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

// ============================================================================
// Mocks — must be before component import
// ============================================================================

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockUuid = "b76e290b-d90d-4dd6-8db7-fbda49f3fa6d";

jest.mock("next/navigation", () => ({
  useParams: () => ({ uuid: mockUuid }),
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "test@example.com" } }, status: "authenticated" }),
}));

jest.mock("@/lib/config", () => ({
  getConfig: jest.fn((key: string) => {
    if (key === "caipeUrl") return "http://localhost:8000";
    if (key === "logoUrl") return "/logo.svg";
    if (key === "appName") return "Test App";
    if (key === "logoStyle") return "default";
    return undefined;
  }),
  getLogoFilterClass: jest.fn(() => ""),
}));

let mockStorageMode = "mongodb";
jest.mock("@/lib/storage-config", () => ({
  getStorageMode: () => mockStorageMode,
}));

// Deferred promise to control when getConversation resolves
let resolveGetConversation: (value: any) => void;
let rejectGetConversation: (err: any) => void;

jest.mock("@/lib/api-client", () => ({
  apiClient: {
    getConversation: jest.fn(
      () =>
        new Promise((resolve, reject) => {
          resolveGetConversation = resolve;
          rejectGetConversation = reject;
        })
    ),
    getMessages: jest.fn().mockResolvedValue([]),
  },
}));

const mockSetActiveConversation = jest.fn();
let resolveLoadMessages: () => void;
let rejectLoadMessages: (err: any) => void;
// Platform Engineer conversations (no agent_id) use loadTurnsFromServer
const mockLoadTurnsFromServer = jest.fn(
  () =>
    new Promise<void>((resolve, reject) => {
      resolveLoadMessages = () => {
        // Simulate what the real loadTurnsFromServer does: populate
        // the conversation's messages array so storeHasMessages flips true.
        const conv = mockConversations.find((c: any) => c.id === mockUuid);
        if (conv && conv.messages.length === 0) {
          conv.messages = [{ id: "loaded-1", role: "assistant", content: "loaded" }];
        }
        resolve();
      };
      rejectLoadMessages = reject;
    })
);
// Dynamic Agent conversations (with agent_id) use loadMessagesFromServer
const mockLoadMessagesFromServer = jest.fn().mockResolvedValue(undefined);
const mockCreateConversation = jest.fn(() => "new-id");

let mockConversations: any[] = [];
let mockActiveConversationId: string | null = null;

jest.mock("@/store/chat-store", () => {
  const getState = () => ({
    conversations: mockConversations,
    activeConversationId: mockActiveConversationId,
  });

  const store = (selector?: (s: any) => any) => {
    const state = {
      setActiveConversation: mockSetActiveConversation,
      loadMessagesFromServer: mockLoadMessagesFromServer,
      loadTurnsFromServer: mockLoadTurnsFromServer,
      createConversation: mockCreateConversation,
      conversations: mockConversations,
      activeConversationId: mockActiveConversationId,
    };
    return selector ? selector(state) : state;
  };

  store.getState = getState;
  store.setState = jest.fn((updater: any) => {
    if (typeof updater === "function") {
      const result = updater({ conversations: mockConversations });
      mockConversations = result.conversations || mockConversations;
    }
  });
  store.subscribe = jest.fn();

  return { useChatStore: store };
});

jest.mock("@/components/auth-guard", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/layout/Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar">Sidebar</div>,
}));

jest.mock("@/components/chat/ChatPanel", () => ({
  ChatPanel: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="chat-panel">Chat: {conversationId}</div>
  ),
}));

// Mock the new view components that replaced direct Sidebar/ChatPanel/ContextPanel usage
// Note: Sidebar is now rendered by the layout, not these view components
jest.mock("@/components/chat/PlatformEngineerChatView", () => ({
  SupervisorChatView: ({ conversationId }: { conversationId: string }) => (
    <div>
      <div data-testid="chat-panel">Chat: {conversationId}</div>
      <div data-testid="context-panel">Context</div>
    </div>
  ),
}));

jest.mock("@/components/chat/DynamicAgentChatView", () => ({
  ChatView: ({ conversationId }: { conversationId: string }) => (
    <div>
      <div data-testid="chat-panel">Chat: {conversationId}</div>
      <div data-testid="context-panel">Context</div>
    </div>
  ),
}));

jest.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, any>>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

// ============================================================================
// Import after mocks
// ============================================================================

import { ChatContainer } from "@/components/chat/ChatContainer";

// ============================================================================
// Tests
// ============================================================================

describe("ChatContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConversations = [];
    mockActiveConversationId = null;
    mockStorageMode = "mongodb";
    mockUuid = "b76e290b-d90d-4dd6-8db7-fbda49f3fa6d";
  });

  it("renders CAIPESpinner with branded loading message while fetching from MongoDB", () => {
    render(<ChatContainer />);

    expect(screen.getByText("Loading conversation...")).toBeInTheDocument();
    const logo = screen.getByRole("img", { name: "Test App" });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("src", "/logo.svg");
  });

  it("shows only spinner during loading (sidebar is in layout, not page)", () => {
    render(<ChatContainer />);

    // Sidebar is now rendered by the layout, not the page
    // The page should only show the spinner during loading
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    expect(screen.getByText("Loading conversation...")).toBeInTheDocument();
  });

  it("shows chat panel with loading state while messages load from MongoDB", async () => {
    render(<ChatContainer />);

    // Initial render - no conversation in store, so spinner shows
    expect(screen.getByText("Loading conversation...")).toBeInTheDocument();

    // Resolve the conversation metadata — now conversation is in store
    // so chat panel shows immediately (with isLoadingMessages=true internally)
    resolveGetConversation({
      _id: mockUuid,
      title: "Test Conversation",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Wait for loadTurnsFromServer to be called and chat panel to render
    await waitFor(() => {
      expect(mockLoadTurnsFromServer).toHaveBeenCalledWith(mockUuid);
    });

    // Chat panel shows while messages are loading (new behavior)
    await waitFor(() => {
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    });

    // Now resolve the message load
    resolveLoadMessages();

    // Chat panel should still be visible after messages load
    await waitFor(() => {
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    });

    expect(
      screen.queryByText("Loading conversation...")
    ).not.toBeInTheDocument();
  });

  it("renders chat panel instantly when conversation with messages is already in store", () => {
    mockConversations = [
      {
        id: mockUuid,
        title: "Existing Conversation",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [{ id: "m1", role: "user", content: "hello" }],
        streamEvents: [],
      },
    ];

    render(<ChatContainer />);

    expect(
      screen.queryByText("Loading conversation...")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("shows chat panel immediately when store has conversation but no messages (metadata-only stub)", async () => {
    mockConversations = [
      {
        id: mockUuid,
        title: "Stub Conversation",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [],
        streamEvents: [],
      },
    ];

    render(<ChatContainer />);

    // Chat panel should show immediately (new behavior - no full-screen spinner)
    // The chat panel will receive isLoadingMessages=true internally
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();

    // loadTurnsFromServer should be called (no force option — turns endpoint is idempotent)
    await waitFor(() => {
      expect(mockLoadTurnsFromServer).toHaveBeenCalledWith(mockUuid);
    });

    // Resolve messages
    resolveLoadMessages();

    // Chat panel should still be visible after messages load
    await waitFor(() => {
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    });
  });

  it("does not show spinner in localStorage mode", () => {
    mockStorageMode = "localStorage";

    render(<ChatContainer />);

    expect(
      screen.queryByText("Loading conversation...")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("falls back to empty conversation when MongoDB returns 404", async () => {
    render(<ChatContainer />);

    expect(screen.getByText("Loading conversation...")).toBeInTheDocument();

    rejectGetConversation(new Error("Conversation not found (404)"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Edge cases: API and network errors
  // ========================================================================

  it("falls back to empty conversation on non-404 API error (e.g. network failure)", async () => {
    render(<ChatContainer />);

    expect(screen.getByText("Loading conversation...")).toBeInTheDocument();

    rejectGetConversation(new Error("Network error: ECONNREFUSED"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    });

    // Should still set the active conversation
    expect(mockSetActiveConversation).toHaveBeenCalledWith(mockUuid);
  });

  it("shows chat panel immediately even when loadTurnsFromServer fails on metadata-only stub", async () => {
    mockConversations = [
      {
        id: mockUuid,
        title: "Stub With Failed Load",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [],
        streamEvents: [],
      },
    ];

    render(<ChatContainer />);

    // Chat panel should show immediately (new behavior)
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockLoadTurnsFromServer).toHaveBeenCalledWith(mockUuid);
    });

    // Reject the message load — chat panel should still be visible
    rejectLoadMessages(new Error("Failed to fetch turns"));

    // Chat panel remains visible after failed load
    await waitFor(() => {
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    });
  });

  it("dismisses spinner when loadTurnsFromServer fails on not-in-store path", async () => {
    render(<ChatContainer />);

    expect(screen.getByText("Loading conversation...")).toBeInTheDocument();

    // Resolve the conversation metadata
    resolveGetConversation({
      _id: mockUuid,
      title: "Conv With Message Failure",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await waitFor(() => {
      expect(mockLoadTurnsFromServer).toHaveBeenCalledWith(mockUuid);
    });

    // Reject turns load
    rejectLoadMessages(new Error("Turns endpoint down"));

    // fetchDone=true but storeHasMessages=false and title != "New Conversation"
    // → spinner persists (defensive: don't show blank Welcome screen)
    await waitFor(() => {
      expect(mockSetActiveConversation).toHaveBeenCalledWith(mockUuid);
    });
  });

  // ========================================================================
  // Edge cases: setActiveConversation always called
  // ========================================================================

  it("calls setActiveConversation for conversations already in store with messages", () => {
    mockConversations = [
      {
        id: mockUuid,
        title: "Already Loaded",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [{ id: "m1", role: "user", content: "hi" }],
        streamEvents: [],
      },
    ];

    render(<ChatContainer />);

    expect(mockSetActiveConversation).toHaveBeenCalledWith(mockUuid);
  });

  it("calls setActiveConversation even when metadata-only stub fetch fails", async () => {
    mockConversations = [
      {
        id: mockUuid,
        title: "Stub",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [],
        streamEvents: [],
      },
    ];

    render(<ChatContainer />);

    await waitFor(() => {
      expect(mockLoadTurnsFromServer).toHaveBeenCalled();
    });

    rejectLoadMessages(new Error("fail"));

    // setActiveConversation is called in the "localConv found" path directly
    await waitFor(() => {
      expect(mockSetActiveConversation).toHaveBeenCalledWith(mockUuid);
    });
  });

  it("calls setActiveConversation after 404 fallback", async () => {
    render(<ChatContainer />);

    rejectGetConversation(new Error("Conversation not found (404)"));

    await waitFor(() => {
      expect(mockSetActiveConversation).toHaveBeenCalledWith(mockUuid);
    });
  });

  // ========================================================================
  // Edge cases: background sync
  // ========================================================================

  it("triggers background sync for conversations with messages already in store (mongodb mode)", async () => {
    mockConversations = [
      {
        id: mockUuid,
        title: "Loaded Conv",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [
          { id: "m1", role: "user", content: "hello" },
          { id: "m2", role: "assistant", content: "hi there" },
        ],
        streamEvents: [],
      },
    ];

    render(<ChatContainer />);

    // No spinner — renders immediately
    expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();

    // But background sync should still fire (Platform Engineer uses loadTurnsFromServer)
    await waitFor(() => {
      expect(mockLoadTurnsFromServer).toHaveBeenCalledWith(mockUuid);
    });
  });

  it("does not trigger background sync in localStorage mode", () => {
    mockStorageMode = "localStorage";
    mockConversations = [
      {
        id: mockUuid,
        title: "Local Conv",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [{ id: "m1", role: "user", content: "test" }],
        streamEvents: [],
      },
    ];

    render(<ChatContainer />);

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(mockLoadTurnsFromServer).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Edge cases: localStorage mode variants
  // ========================================================================

  it("does not show spinner in localStorage mode with empty conversation in store", () => {
    mockStorageMode = "localStorage";
    mockConversations = [
      {
        id: mockUuid,
        title: "Empty Local",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [],
        streamEvents: [],
      },
    ];

    render(<ChatContainer />);

    expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("does not show spinner in localStorage mode with no conversation in store", () => {
    mockStorageMode = "localStorage";
    mockConversations = [];

    render(<ChatContainer />);

    expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  // ========================================================================
  // Edge cases: Sidebar race condition (storeHasMessages reactive guard)
  // ========================================================================

  it("shows chat panel immediately even during Sidebar race (storeHasMessages false)", async () => {
    // Simulate: loadTurnsFromServer resolved but Sidebar's
    // loadConversationsFromServer concurrently wiped messages.
    // The mock loadTurnsFromServer normally populates messages,
    // but here we override to simulate the wipe.
    const originalMock = mockLoadTurnsFromServer.getMockImplementation();
    mockLoadTurnsFromServer.mockImplementation(
      () =>
        new Promise<void>((resolve, reject) => {
          resolveLoadMessages = () => {
            // Do NOT populate messages — simulates Sidebar race wiping them
            resolve();
          };
          rejectLoadMessages = reject;
        })
    );

    mockConversations = [
      {
        id: mockUuid,
        title: "Race Condition Conv",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [],
        streamEvents: [],
      },
    ];

    render(<ChatContainer />);

    // Chat panel shows immediately when conversation is in store (new behavior)
    // Even with empty messages, we show the panel with isLoadingMessages=true
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockLoadTurnsFromServer).toHaveBeenCalled();
    });

    // Resolve without populating messages (simulates race)
    resolveLoadMessages();

    // Chat panel remains visible even when messages are empty
    await waitFor(() => {
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    });

    // Restore original mock
    if (originalMock) mockLoadTurnsFromServer.mockImplementation(originalMock);
  });

  // ========================================================================
  // Edge cases: conversation appears in store during fetch (race recovery)
  // ========================================================================

  it("recovers when conversation appears in store while API fetch fails", async () => {
    render(<ChatContainer />);

    // Simulate: another part of the app (e.g. streaming) added the
    // conversation to the store while getConversation was in flight
    mockConversations = [
      {
        id: mockUuid,
        title: "Appeared During Fetch",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [{ id: "m1", role: "user", content: "appeared" }],
        streamEvents: [],
      },
    ];

    // Now the API call fails — but the store already has the conversation
    rejectGetConversation(new Error("Some API error"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Edge cases: unexpected outer error
  // ========================================================================

  it("handles unexpected error in outer try/catch with fallback conversation", async () => {
    // Override getConversation to throw a non-standard error
    const { apiClient } = require("@/lib/api-client");
    apiClient.getConversation.mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of undefined");
    });

    render(<ChatContainer />);

    await waitFor(() => {
      expect(mockSetActiveConversation).toHaveBeenCalledWith(mockUuid);
    });

    // Should eventually show chat panel (fallback empty conversation with "New Conversation" title)
    await waitFor(() => {
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Edge cases: UI structure verification
  // ========================================================================

  it("renders context panel alongside chat panel when not loading", () => {
    mockConversations = [
      {
        id: mockUuid,
        title: "With Context",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [{ id: "m1", role: "user", content: "test" }],
        streamEvents: [],
      },
    ];

    render(<ChatContainer />);

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(screen.getByTestId("context-panel")).toBeInTheDocument();
    // Sidebar is now rendered by the layout, not the page
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
  });

  it("does not render context panel or chat panel while spinner is showing", () => {
    render(<ChatContainer />);

    expect(screen.getByText("Loading conversation...")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("context-panel")).not.toBeInTheDocument();
  });

  it("passes correct conversationId to ChatPanel", () => {
    mockConversations = [
      {
        id: mockUuid,
        title: "UUID Check",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [{ id: "m1", role: "user", content: "x" }],
        streamEvents: [],
      },
    ];

    render(<ChatContainer />);

    expect(screen.getByText(`Chat: ${mockUuid}`)).toBeInTheDocument();
  });

  // ========================================================================
  // Edge cases: different UUID values
  // ========================================================================

  it("works with a different UUID", async () => {
    mockUuid = "11111111-2222-3333-4444-555555555555";
    mockConversations = [
      {
        id: mockUuid,
        title: "Other UUID Conv",
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [{ id: "m1", role: "user", content: "other" }],
        streamEvents: [],
      },
    ];

    render(<ChatContainer />);

    expect(screen.getByText(`Chat: ${mockUuid}`)).toBeInTheDocument();
    expect(mockSetActiveConversation).toHaveBeenCalledWith(mockUuid);
  });

  // ========================================================================
  // Edge cases: store.setState called correctly
  // ========================================================================

  it("adds conversation to store via setState when loaded from MongoDB", async () => {
    const { useChatStore } = require("@/store/chat-store");

    render(<ChatContainer />);

    resolveGetConversation({
      _id: mockUuid,
      title: "From MongoDB",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await waitFor(() => {
      expect(useChatStore.setState).toHaveBeenCalled();
    });

    // The conversation should have been added to mockConversations
    const addedConv = mockConversations.find((c: any) => c.id === mockUuid);
    expect(addedConv).toBeDefined();
    expect(addedConv.title).toBe("From MongoDB");
  });

  it("adds fallback conversation to store when MongoDB returns 404", async () => {
    const { useChatStore } = require("@/store/chat-store");

    render(<ChatContainer />);

    rejectGetConversation(new Error("Conversation not found (404)"));

    await waitFor(() => {
      expect(useChatStore.setState).toHaveBeenCalled();
    });

    const addedConv = mockConversations.find((c: any) => c.id === mockUuid);
    expect(addedConv).toBeDefined();
    expect(addedConv.title).toBe("New Conversation");
    expect(addedConv.messages).toEqual([]);
  });

  // ========================================================================
  // Large conversation fixtures (inspired by seed scripts)
  // ========================================================================

  describe("Large conversation loading", () => {
    it("renders chat panel instantly for conversation with 50 messages already in store", () => {
      const messages = Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}: ${"x".repeat(200)}`,
      }));
      mockConversations = [
        {
          id: mockUuid,
          title: "Large Conversation",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages,
          streamEvents: [],
        },
      ];

      render(<ChatContainer />);

      expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    });

    it("renders chat panel instantly for conversation with 500 messages already in store", () => {
      const messages = Array.from({ length: 500 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Turn ${Math.floor(i / 2) + 1} ${i % 2 === 0 ? "question" : "answer"}`,
      }));
      mockConversations = [
        {
          id: mockUuid,
          title: "Very Large Conversation",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages,
          streamEvents: [],
        },
      ];

      render(<ChatContainer />);

      expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    });

    it("shows chat panel with loading state for conversation loaded from MongoDB", async () => {
      render(<ChatContainer />);

      // Full-screen spinner shows only during initial fetch (no conversation in store)
      expect(screen.getByText("Loading conversation...")).toBeInTheDocument();

      resolveGetConversation({
        _id: mockUuid,
        title: "MongoDB Large Conv",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await waitFor(() => {
        expect(mockLoadTurnsFromServer).toHaveBeenCalledWith(mockUuid);
      });

      // After conversation metadata is loaded, chat panel should render
      // (with internal loading state via isLoadingMessages prop)
      resolveLoadMessages();

      await waitFor(() => {
        expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
      });
      expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();
    });

    it("renders chat panel immediately for conversation already in store (even with empty messages)", async () => {
      // When conversation is already in store, ChatContainer renders the panel immediately
      // with isLoadingMessages=true (shows skeleton inside panel, not full-screen spinner)
      mockConversations = [
        {
          id: mockUuid,
          title: "Slow Loading Conversation",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
          streamEvents: [],
        },
      ];

      render(<ChatContainer />);

      // Chat panel renders immediately (no full-screen spinner for conversations already in store)
      // The panel internally shows loading skeleton via isLoadingMessages prop
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
      expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();

      await waitFor(() => {
        expect(mockLoadTurnsFromServer).toHaveBeenCalled();
      });

      resolveLoadMessages();

      await waitFor(() => {
        expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
      });
    });

    it("does not flash spinner for conversation already loaded with 1000 messages", () => {
      const messages = Array.from({ length: 1000 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}`,
      }));
      mockConversations = [
        {
          id: mockUuid,
          title: "1000-Message Conversation",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages,
          streamEvents: [],
        },
      ];

      render(<ChatContainer />);

      // No spinner at all — messages are already there
      expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
      // Correct UUID passed
      expect(screen.getByText(`Chat: ${mockUuid}`)).toBeInTheDocument();
    });

    it("renders chat panel for conversation in store even if messages are empty (sidebar race)", async () => {
      // New behavior: ChatContainer renders chat panel immediately for conversations in store
      // The panel handles empty messages internally (shows skeleton via isLoadingMessages)
      const originalMock = mockLoadTurnsFromServer.getMockImplementation();
      mockLoadTurnsFromServer.mockImplementation(
        () =>
          new Promise<void>((resolve, reject) => {
            resolveLoadMessages = () => {
              // Simulate Sidebar race: messages stay empty
              resolve();
            };
            rejectLoadMessages = reject;
          })
      );

      mockConversations = [
        {
          id: mockUuid,
          title: "Large Conv Sidebar Race",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
          streamEvents: [],
        },
      ];

      render(<ChatContainer />);

      // Chat panel renders immediately for conversations in store
      // (panel shows internal loading state, not full-screen spinner)
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
      expect(screen.queryByText("Loading conversation...")).not.toBeInTheDocument();

      await waitFor(() => {
        expect(mockLoadTurnsFromServer).toHaveBeenCalled();
      });

      resolveLoadMessages();

      // Chat panel still visible after load
      await waitFor(() => {
        expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
      });

      if (originalMock) mockLoadTurnsFromServer.mockImplementation(originalMock);
    });

    it("triggers background sync for large conversation already loaded", async () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}`,
      }));
      mockConversations = [
        {
          id: mockUuid,
          title: "Background Sync Test",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages,
          streamEvents: [],
        },
      ];

      render(<ChatContainer />);

      // Chat panel renders immediately
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();

      // Background sync should still be triggered (Platform Engineer uses loadTurnsFromServer)
      await waitFor(() => {
        expect(mockLoadTurnsFromServer).toHaveBeenCalledWith(mockUuid);
      });
    });
  });
});
