import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  AgenticSdlcAssistantBubble,
  buildAgenticSdlcPageContext,
  buildAgenticSdlcSuggestedPrompts,
} from "@/components/agentic-sdlc/AgenticSdlcAssistantBubble";

const mockUseAgenticSdlcFeature = jest.fn();
const mockGetConfig = jest.fn();
const mockCreateConversation = jest.fn();
const mockSetActiveConversation = jest.fn();
const mockIsConversationStreaming = jest.fn();
let mockPathname = "/agentic-sdlc";

jest.mock("@/hooks/use-agentic-sdlc-feature", () => ({
  useAgenticSdlcFeature: () => mockUseAgenticSdlcFeature(),
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => mockGetConfig(key),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

jest.mock("@/store/chat-store", () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      createConversation: mockCreateConversation,
      setActiveConversation: mockSetActiveConversation,
      isConversationStreaming: mockIsConversationStreaming,
    }),
}));

jest.mock("@/components/chat/DynamicAgentChatView", () => ({
  ChatView: jest.fn((props) => (
    <div
      data-testid="agentic-sdlc-chat-view"
      data-agent-id={props.selectedAgentId}
      data-conversation-id={props.conversationId}
      data-context={JSON.stringify(props.clientContext)}
      data-suggested-prompts={JSON.stringify(props.suggestedPrompts ?? [])}
      data-hide-context-panel={String(props.hideContextPanel ?? false)}
      data-empty-state-title={props.emptyStateTitle ?? ""}
      data-empty-state-subtitle={props.emptyStateSubtitle ?? ""}
      data-surface={props.surface ?? "default"}
      data-font-scale={props.fontScale ?? "default"}
      data-suggested-prompts-initially-hidden={String(
        props.suggestedPromptsInitiallyHidden ?? false,
      )}
    >
      Dynamic agent chat
    </div>
  )),
}));

describe("AgenticSdlcAssistantBubble", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockPathname = "/agentic-sdlc/cisco-eti/sri-speckit-test/epics/I_42";
    mockUseAgenticSdlcFeature.mockReturnValue({
      enabled: true,
      assistantEnabled: true,
      disabledReason: null,
    });
    mockGetConfig.mockImplementation((key: string) => {
      if (key === "dynamicAgentsEnabled") return true;
      if (key === "dynamicAgentsUrl") return "http://localhost:8100";
      return undefined;
    });
    mockCreateConversation.mockResolvedValue("agentic-sdlc-conversation");
    mockSetActiveConversation.mockImplementation(() => undefined);
    mockIsConversationStreaming.mockReturnValue(false);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          _id: "agent-agentic-sdlc",
          name: "agentic-sdlc",
          description: "Agentic SDLC assistant",
          model: { id: "test-model", provider: "test" },
          visibility: "global",
          allowed_tools: {},
          subagents: [],
          skills: [],
          ui: { gradient_theme: "ocean" },
          enabled: true,
        },
      }),
    }) as jest.Mock;
  });

  it("shows the bubble with setup guidance when the assistant feature is disabled", async () => {
    const user = userEvent.setup();
    mockUseAgenticSdlcFeature.mockReturnValue({
      enabled: true,
      assistantEnabled: false,
      disabledReason: null,
    });

    render(<AgenticSdlcAssistantBubble />);

    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );

    expect(
      screen.getByText(/turn on ship_loop_assistant_enabled/i),
    ).toBeInTheDocument();
  });

  it("opens the pinned agentic-sdlc dynamic agent with page context", async () => {
    const user = userEvent.setup();
    render(<AgenticSdlcAssistantBubble />);

    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("agentic-sdlc-chat-view")).toBeInTheDocument(),
    );
    expect(mockCreateConversation).toHaveBeenCalledWith("agent-agentic-sdlc");
    expect(mockSetActiveConversation).toHaveBeenCalledWith(
      "agentic-sdlc-conversation",
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/dynamic-agents/agents/agent-agentic-sdlc",
    );

    const chat = screen.getByTestId("agentic-sdlc-chat-view");
    expect(chat).toHaveAttribute("data-agent-id", "agent-agentic-sdlc");
    expect(chat).toHaveAttribute("data-hide-context-panel", "true");
    expect(chat).toHaveAttribute(
      "data-empty-state-title",
      "Agentic SDLC Assistant",
    );
    expect(chat).toHaveAttribute(
      "data-empty-state-subtitle",
      "Ask about this repo, Epic, or the live development loop.",
    );
    expect(chat).toHaveAttribute("data-surface", "default");
    expect(chat).toHaveAttribute("data-font-scale", "compact");
    expect(JSON.parse(chat.getAttribute("data-context") ?? "{}")).toMatchObject(
      {
        source: "agentic-sdlc",
        route: "/agentic-sdlc/cisco-eti/sri-speckit-test/epics/I_42",
        scope: "epic",
        owner: "cisco-eti",
        repo: "sri-speckit-test",
        epicId: "I_42",
      },
    );
  });

  it("bounds the embedded chat view so the composer is not clipped by popup chrome", async () => {
    const user = userEvent.setup();
    render(<AgenticSdlcAssistantBubble />);

    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("agentic-sdlc-chat-view")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("agentic-sdlc-chat-slot")).toHaveClass(
      "min-h-0",
      "flex-1",
      "overflow-hidden",
    );
  });

  it("uses a wider resizable panel below the header/profile menu layer", async () => {
    const user = userEvent.setup();
    render(<AgenticSdlcAssistantBubble />);

    const button = screen.getByRole("button", {
      name: /open agentic sdlc assistant/i,
    });
    expect(screen.getByTestId("agentic-sdlc-assistant-bot-icon")).toBeInTheDocument();
    expect(button.parentElement).toHaveClass("z-40");
    expect(button.parentElement).toHaveStyle({
      position: "fixed",
      right: "1.25rem",
      bottom: "1.25rem",
    });

    await user.click(button);

    expect(
      screen.getByRole("region", { name: /agentic sdlc assistant/i }),
    ).toHaveStyle({
      width: "min(720px, calc(100vw - 2rem))",
      height: "min(780px, calc(100vh - 7rem))",
    });
    expect(
      screen.getByRole("button", { name: /^resize agentic sdlc assistant$/i }),
    ).toBeInTheDocument();
  });

  it("expands the popup by dragging the translucent resize dial", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1400,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 1000,
    });

    const user = userEvent.setup();
    render(<AgenticSdlcAssistantBubble />);

    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );

    const panel = screen.getByRole("region", {
      name: /agentic sdlc assistant/i,
    });
    const dial = screen.getByRole("button", {
      name: /^resize agentic sdlc assistant$/i,
    });

    fireEvent(
      dial,
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 300,
        clientY: 300,
      }),
    );
    fireEvent(
      window,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    );
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));

    expect(panel).toHaveStyle({
      width: "min(920px, calc(100vw - 2rem))",
      height: "min(888px, calc(100vh - 7rem))",
    });
  });

  it("does not render a lower resize handle over the embedded composer", async () => {
    const user = userEvent.setup();
    render(<AgenticSdlcAssistantBubble />);

    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );

    expect(
      screen.queryByRole("button", {
        name: /resize agentic sdlc assistant from bottom-left/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /^resize agentic sdlc assistant$/i,
      }),
    ).toHaveClass("top-3");
  });

  it("opens with a solid assistant panel by default", async () => {
    const user = userEvent.setup();
    render(<AgenticSdlcAssistantBubble />);

    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );

    const panel = screen.getByRole("region", {
      name: /agentic sdlc assistant/i,
    });
    expect(panel).toHaveClass("bg-background");
    expect(panel).not.toHaveClass("bg-cyan-950/10", "backdrop-blur-3xl");
  });

  it("toggles the assistant panel into translucent glass mode", async () => {
    const user = userEvent.setup();
    render(<AgenticSdlcAssistantBubble />);

    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /enable translucent assistant mode/i }),
    );

    const panel = screen.getByRole("region", {
      name: /agentic sdlc assistant/i,
    });
    expect(panel).toHaveClass(
      "bg-cyan-950/10",
      "backdrop-blur-3xl",
      "backdrop-saturate-200",
      "ring-1",
      "ring-cyan-200/45",
    );
    expect(screen.getByTestId("agentic-sdlc-chat-view")).toHaveAttribute(
      "data-surface",
      "glass",
    );
    expect(
      screen.getByRole("button", { name: /disable translucent assistant mode/i }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("agentic-sdlc-assistant-glass")).toBe(
      "true",
    );
  });

  it("restores the persisted translucent assistant mode preference", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("agentic-sdlc-assistant-glass", "true");

    render(<AgenticSdlcAssistantBubble />);

    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );

    expect(
      screen.getByRole("region", { name: /agentic sdlc assistant/i }),
    ).toHaveClass("bg-cyan-950/10", "backdrop-blur-3xl");
  });

  it("passes context-aware suggested prompts for repo pages", async () => {
    const user = userEvent.setup();
    mockPathname = "/agentic-sdlc/cisco-eti/sri-speckit-test";
    render(<AgenticSdlcAssistantBubble />);

    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("agentic-sdlc-chat-view")).toBeInTheDocument(),
    );
    const prompts = JSON.parse(
      screen
        .getByTestId("agentic-sdlc-chat-view")
        .getAttribute("data-suggested-prompts") ?? "[]",
    ) as string[];
    expect(prompts).toEqual(
      expect.arrayContaining([
        "Create a test Epic and child tasks for cisco-eti/sri-speckit-test.",
        "Summarize what happened in this repo in the last 10 minutes.",
      ]),
    );
  });

  it("cycles the embedded assistant font size from compact to default and large", async () => {
    const user = userEvent.setup();
    render(<AgenticSdlcAssistantBubble />);

    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("agentic-sdlc-chat-view")).toBeInTheDocument(),
    );

    const fontButton = screen.getByRole("button", {
      name: /assistant font size compact/i,
    });
    expect(screen.getByTestId("agentic-sdlc-chat-view")).toHaveAttribute(
      "data-font-scale",
      "compact",
    );

    await user.click(fontButton);
    expect(screen.getByTestId("agentic-sdlc-chat-view")).toHaveAttribute(
      "data-font-scale",
      "default",
    );
    expect(
      screen.getByRole("button", { name: /assistant font size default/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /assistant font size default/i }),
    );
    expect(screen.getByTestId("agentic-sdlc-chat-view")).toHaveAttribute(
      "data-font-scale",
      "large",
    );
    expect(window.localStorage.getItem("agentic-sdlc-assistant-font-scale")).toBe(
      "large",
    );
  });

  it("starts a new assistant thread without reusing the current conversation id", async () => {
    const user = userEvent.setup();
    mockCreateConversation
      .mockResolvedValueOnce("agentic-sdlc-conversation")
      .mockResolvedValueOnce("agentic-sdlc-conversation-2");

    render(<AgenticSdlcAssistantBubble />);

    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("agentic-sdlc-chat-view")).toHaveAttribute(
        "data-conversation-id",
        "agentic-sdlc-conversation",
      ),
    );

    await user.click(
      screen.getByRole("button", { name: /start new assistant thread/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("agentic-sdlc-chat-view")).toHaveAttribute(
        "data-conversation-id",
        "agentic-sdlc-conversation-2",
      ),
    );
    expect(mockCreateConversation).toHaveBeenCalledTimes(2);
    expect(mockCreateConversation).toHaveBeenLastCalledWith("agent-agentic-sdlc");
    expect(mockSetActiveConversation).toHaveBeenLastCalledWith(
      "agentic-sdlc-conversation-2",
    );
  });

  it("shows suggestions on first launch and starts them hidden after that", async () => {
    const user = userEvent.setup();
    render(<AgenticSdlcAssistantBubble />);

    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("agentic-sdlc-chat-view")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("agentic-sdlc-chat-view")).toHaveAttribute(
      "data-suggested-prompts-initially-hidden",
      "false",
    );

    await user.click(
      screen.getByRole("button", { name: /close agentic sdlc assistant/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );

    expect(screen.getByTestId("agentic-sdlc-chat-view")).toHaveAttribute(
      "data-suggested-prompts-initially-hidden",
      "true",
    );
    expect(
      window.localStorage.getItem("agentic-sdlc-assistant-suggestions-seen"),
    ).toBe("true");
  });

  it("shows setup guidance when the pinned dynamic agent config is missing", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    render(<AgenticSdlcAssistantBubble />);
    await user.click(
      screen.getByRole("button", { name: /open agentic sdlc assistant/i }),
    );

    expect(
      await screen.findByText(/create or enable the agentic-sdlc dynamic agent/i),
    ).toBeInTheDocument();
  });
});

describe("buildAgenticSdlcPageContext", () => {
  it("detects home, repo, and epic scopes from the route", () => {
    expect(buildAgenticSdlcPageContext("/agentic-sdlc")).toMatchObject({
      scope: "home",
    });
    expect(
      buildAgenticSdlcPageContext("/agentic-sdlc/cisco-eti/sri-speckit-test"),
    ).toMatchObject({
      scope: "repo",
      owner: "cisco-eti",
      repo: "sri-speckit-test",
    });
    expect(
      buildAgenticSdlcPageContext(
        "/agentic-sdlc/cisco-eti/sri-speckit-test/epics/I_42",
      ),
    ).toMatchObject({
      scope: "epic",
      owner: "cisco-eti",
      repo: "sri-speckit-test",
      epicId: "I_42",
    });
  });
});

describe("buildAgenticSdlcSuggestedPrompts", () => {
  it("does not hardcode a specific repo on non-repo pages", () => {
    const prompts = buildAgenticSdlcSuggestedPrompts({ scope: "home" });

    expect(prompts.join("\n")).not.toContain("cisco-eti/sri-speckit-test");
    expect(prompts).toEqual(
      expect.arrayContaining([
        "Create a test Epic and child tasks for the selected repo.",
      ]),
    );
  });
});
