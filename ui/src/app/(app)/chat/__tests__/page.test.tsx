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
});
