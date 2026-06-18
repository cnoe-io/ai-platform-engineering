/**
 * Unit tests for Chat redirect page (/chat)
 *
 * Tests:
 * - Renders branded CAIPESpinner while resolving which conversation to load
 * - Shows correct loading message
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

// ============================================================================
// Mocks — must be before component import
// ============================================================================

const mockReplace = jest.fn();
const mockFetch = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

let mockSessionStatus: "loading" | "authenticated" | "unauthenticated" = "authenticated";

jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: mockSessionStatus === "authenticated" ? { user: { email: "test@example.com" } } : null,
    status: mockSessionStatus,
  }),
}));

jest.mock("@/lib/config", () => ({
  getConfig: jest.fn((key: string) => {
    if (key === "logoUrl") return "/logo.svg";
    if (key === "appName") return "Test App";
    if (key === "logoStyle") return "default";
    if (key === "ssoEnabled") return false;
    return undefined;
  }),
  getLogoFilterClass: jest.fn(() => ""),
}));

jest.mock("@/lib/storage-config", () => ({
  getStorageMode: () => "mongodb",
}));

const mockCreateConversation = jest.fn(() => "new-conv-id");
const mockLoadConversationsFromServer = jest.fn().mockResolvedValue(undefined);
let mockConversations: any[] = [];
let mockActiveConversationId: string | null = null;
const mockGetLastActiveConversationId = jest.fn(() => null);

jest.mock("@/store/chat-store", () => {
  const getState = () => ({
    conversations: mockConversations,
    activeConversationId: mockActiveConversationId,
  });

  const store = (selector?: (s: any) => any) => {
    const state = {
      createConversation: mockCreateConversation,
      loadConversationsFromServer: mockLoadConversationsFromServer,
      conversations: mockConversations,
      activeConversationId: mockActiveConversationId,
    };
    return selector ? selector(state) : state;
  };

  store.getState = getState;
  store.setState = jest.fn();
  store.subscribe = jest.fn();

  return {
    useChatStore: store,
    getLastActiveConversationId: () => mockGetLastActiveConversationId(),
  };
});

jest.mock("@/components/auth-guard", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ============================================================================
// Import after mocks
// ============================================================================

import Chat from "../page";

// ============================================================================
// Tests
// ============================================================================

describe("Chat Redirect Page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true, data: { default_agent_id: "default-agent" } }),
    });
    mockConversations = [];
    mockActiveConversationId = null;
    mockGetLastActiveConversationId.mockReturnValue(null);
    mockSessionStatus = "authenticated";
  });

  it("renders CAIPESpinner with branded loading message", () => {
    render(<Chat />);

    expect(screen.getByText("Loading conversations...")).toBeInTheDocument();
    // Verify it's the CAIPESpinner (renders an img with the logo)
    const logo = screen.getByRole("img", { name: "Test App" });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("src", "/logo.svg");
  });

  it("does not render the old Loader2 spinner", () => {
    const { container } = render(<Chat />);

    // The old Loader2 icon had this class combo — should NOT be present
    const oldSpinner = container.querySelector(".lucide-loader2");
    expect(oldSpinner).not.toBeInTheDocument();
  });

  it("redirects to the persisted last active conversation after reload", async () => {
    mockGetLastActiveConversationId.mockReturnValue("conv-2");
    mockConversations = [
      {
        id: "conv-1",
        owner_id: "test@example.com",
        updatedAt: new Date("2026-05-18T09:00:00Z"),
      },
      {
        id: "conv-2",
        owner_id: "test@example.com",
        updatedAt: new Date("2026-05-18T08:00:00Z"),
      },
    ];

    render(<Chat />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/chat/conv-2"));
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("creates a new default-agent conversation when the user has no owned conversations", async () => {
    render(<Chat />);

    await waitFor(() => expect(mockCreateConversation).toHaveBeenCalledWith("default-agent"));
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/platform-config");
    expect(mockReplace).toHaveBeenCalledWith("/chat/new-conv-id");
  });

  it("falls back to supervisor when no default agent is configured", async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, data: { default_agent_id: null } }),
    });

    render(<Chat />);

    await waitFor(() => expect(mockCreateConversation).toHaveBeenCalledWith(undefined));
    expect(mockReplace).toHaveBeenCalledWith("/chat/new-conv-id");
  });

  it("does not create a conversation while the session is still loading", async () => {
    mockSessionStatus = "loading";

    render(<Chat />);

    // Give the effect time to run if it were going to
    await new Promise((r) => setTimeout(r, 50));

    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockLoadConversationsFromServer).not.toHaveBeenCalled();
  });

  it("does not create a new conversation when owned conversations already exist", async () => {
    mockConversations = [
      {
        id: "existing-conv",
        owner_id: "test@example.com",
        updatedAt: new Date("2026-05-18T10:00:00Z"),
      },
    ];

    render(<Chat />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/chat/existing-conv"));
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });
});
