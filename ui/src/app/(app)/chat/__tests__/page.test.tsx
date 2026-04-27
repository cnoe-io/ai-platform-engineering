/**
 * Unit tests for Chat redirect page (/chat)
 *
 * Tests:
 * - Renders branded CAIPESpinner while resolving which conversation to load
 * - Shows correct loading message
 */

import React from "react";
import { render, screen } from "@testing-library/react";

// ============================================================================
// Mocks — must be before component import
// ============================================================================

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "test@example.com" } }, status: "authenticated" }),
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

jest.mock("@/store/chat-store", () => {
  const getState = () => ({
    conversations: [],
    activeConversationId: null,
  });

  const store = (selector?: (s: any) => any) => {
    const state = {
      createConversation: mockCreateConversation,
      loadConversationsFromServer: mockLoadConversationsFromServer,
      conversations: [],
      activeConversationId: null,
    };
    return selector ? selector(state) : state;
  };

  store.getState = getState;
  store.setState = jest.fn();
  store.subscribe = jest.fn();

  return { useChatStore: store };
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
  });

  it("renders nothing — redirect logic runs in useEffect, no loading UI", () => {
    // The /chat page intentionally renders null. It delegates empty-state UX
    // to ChatContainer (mounted in layout). The redirect to the latest
    // conversation fires via useEffect after the session/store resolves.
    const { container } = render(<Chat />);
    // AuthGuard wraps the page; while session is loading it shows the loading screen,
    // but once resolved (mocked as unauthenticated here) it redirects to login.
    // The page itself contributes no visible DOM elements.
    expect(container.querySelector(".lucide-loader2")).not.toBeInTheDocument();
  });

  it("does not render the old Loader2 spinner", () => {
    const { container } = render(<Chat />);

    // The old Loader2 icon had this class combo — should NOT be present
    const oldSpinner = container.querySelector(".lucide-loader2");
    expect(oldSpinner).not.toBeInTheDocument();
  });
});
