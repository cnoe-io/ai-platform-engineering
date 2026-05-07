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
const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => mockSearchParams,
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
    if (key === "autonomousAgentsEnabled") return true;
    return undefined;
  }),
  getLogoFilterClass: jest.fn(() => ""),
}));

jest.mock("@/lib/storage-config", () => ({
  getStorageMode: () => "mongodb",
}));

const mockCreateConversation = jest.fn().mockResolvedValue("new-conv-id");
const mockLoadConversationsFromServer = jest.fn().mockResolvedValue(undefined);
const mockLoadAutonomousConversationsFromService = jest.fn().mockResolvedValue(undefined);

let mockConversations: any[] = [];
let mockActiveConversationId: string | null = null;

jest.mock("@/store/chat-store", () => {
  const getState = () => ({
    conversations: mockConversations,
    activeConversationId: mockActiveConversationId,
  });

  const store = (selector?: (s: any) => any) => {
    const state = {
      createConversation: mockCreateConversation,
      loadConversationsFromServer: mockLoadConversationsFromServer,
      loadAutonomousConversationsFromService: mockLoadAutonomousConversationsFromService,
      conversations: mockConversations,
      activeConversationId: mockActiveConversationId,
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
    mockSearchParams = new URLSearchParams();
    mockConversations = [];
    mockActiveConversationId = null;
    mockLoadConversationsFromServer.mockResolvedValue(undefined);
    mockLoadAutonomousConversationsFromService.mockResolvedValue(undefined);
    mockCreateConversation.mockResolvedValue("new-conv-id");
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

  it("source=autonomous selects an autonomous conversation instead of a normal conversation", async () => {
    mockSearchParams = new URLSearchParams("source=autonomous");
    mockActiveConversationId = "normal-conv";
    mockConversations = [
      {
        id: "normal-conv",
        title: "Normal",
        owner_id: "test@example.com",
        source: "web",
        updatedAt: new Date("2026-01-02"),
      },
      {
        id: "auto-conv",
        title: "Auto",
        owner_id: "test@example.com",
        source: "autonomous",
        updatedAt: new Date("2026-01-01"),
      },
    ];

    render(<Chat />);

    await waitFor(() => {
      expect(mockLoadConversationsFromServer).toHaveBeenCalledWith({ source: "autonomous" });
      expect(mockLoadAutonomousConversationsFromService).toHaveBeenCalled();
    });
    await screen.findByText("Loading conversations...");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/chat/auto-conv");
    });
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("source=autonomous with no autonomous conversations shows an empty state and does not create a normal chat", async () => {
    mockSearchParams = new URLSearchParams("source=autonomous");
    mockConversations = [
      {
        id: "normal-conv",
        title: "Normal",
        owner_id: "test@example.com",
        source: "web",
        updatedAt: new Date("2026-01-02"),
      },
    ];

    render(<Chat />);

    expect(await screen.findByText("No autonomous task threads yet")).toBeInTheDocument();
    expect(screen.getByText("Go to Autonomous Agents")).toBeInTheDocument();
    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
