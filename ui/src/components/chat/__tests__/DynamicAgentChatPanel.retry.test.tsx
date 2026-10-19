import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChatMessage, Conversation } from "@/types/a2a";
import { ChatPanel } from "../DynamicAgentChatPanel";

let mockConversation: Conversation;
let mockStreaming = false;
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
const mockToast = jest.fn();
const mockStreamMessage = jest.fn().mockResolvedValue(undefined);
const mockChatState = {
  activeConversationId: "chat-1",
  getActiveConversation: () => mockConversation,
  get conversations() { return [mockConversation]; },
  isConversationStreaming: () => mockStreaming,
  consumePendingMessage: () => null,
  addMessage: jest.fn(() => "typed-message"),
  updateMessage: jest.fn(),
  appendToMessage: jest.fn(),
  clearStreamEvents: jest.fn(),
  setConversationStreaming: jest.fn(),
  loadMessagesFromServer: jest.fn(),
  contextUsageByConversation: {},
  messageHistory: {},
  setContextUsage: jest.fn(),
  loadOlderMessagesFromServer: jest.fn().mockResolvedValue(undefined),
};

jest.mock("@/store/chat-store", () => ({
  useChatStore: Object.assign(() => mockChatState, { getState: () => mockChatState }),
}));
jest.mock("@/store/feature-flag-store", () => ({
  useFeatureFlagStore: (selector: (state: unknown) => unknown) => selector({
    flags: { autoScroll: false }, initialize: jest.fn(),
  }),
}));
jest.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/lib/config", () => ({ getConfig: (key: string) => key === "appName" ? "Test agent" : false }));
jest.mock("@/components/autonomous/api", () => ({
  autonomousApi: { openFollowUpChat: jest.fn(), listFollowUpChats: async () => ({}) },
}));
jest.mock("@/lib/streaming", () => ({
  createStreamAdapter: () => ({ streamMessage: mockStreamMessage, abort: jest.fn() }),
}));
jest.mock("@/hooks/useDynamicAgentTimeline", () => ({ useAgentTimeline: () => ({ data: {} }) }));
jest.mock("@/components/shared/timeline", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));
jest.mock("@/components/dynamic-agents/AgentAvatar", () => ({ AgentAvatar: () => null }));
jest.mock("../DynamicAgentTimeline", () => ({ AgentTimeline: () => null }));
jest.mock("../FeedbackButton", () => ({ FeedbackButton: () => null }));
jest.mock("../useSlashCommands", () => ({ useSlashCommands: () => [] }));
jest.mock("../CustomCallButtons", () => ({ DEFAULT_AGENTS: [] }));

const message = (id: string, role: "user" | "assistant", content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role,
  content,
  timestamp: new Date("2026-09-01T10:00:00Z"),
  turnId: id,
  ...extra,
} as ChatMessage);

function setConversation(messages: ChatMessage[], extra: Partial<Conversation> = {}) {
  mockConversation = {
    id: "chat-1",
    title: "Example",
    source: "web",
    messages,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  } as Conversation;
}

const lastRequest = () => mockStreamMessage.mock.calls.at(-1)?.[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockStreaming = false;
  HTMLElement.prototype.scrollIntoView = jest.fn();
  setConversation([
    message("u1", "user", "first question"),
    message("a1", "assistant", "first answer"),
    message("u2", "user", "second question"),
    message("a2", "assistant", "second answer"),
  ]);
});

describe("retry alongside edit", () => {
  it("offers retry, regenerate and edit together", () => {
    render(<ChatPanel agentId="example-agent" conversationId="chat-1" />);
    expect(screen.getAllByRole("button", { name: "Retry this prompt" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Regenerate response" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Edit message" })).toHaveLength(2);
  });

  it("re-sends a user prompt as a new turn without rewinding", async () => {
    render(<ChatPanel agentId="example-agent" conversationId="chat-1" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Retry this prompt" })[0]);
    await waitFor(() => expect(mockStreamMessage).toHaveBeenCalledTimes(1));
    expect(lastRequest()).toEqual(expect.objectContaining({ conversationId: "chat-1", message: "first question" }));
    expect(screen.queryByText(/rewind/i)).toBeNull();
  });

  it("regenerates an answer from the prompt that preceded it", async () => {
    render(<ChatPanel agentId="example-agent" conversationId="chat-1" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Regenerate response" })[1]);
    await waitFor(() => expect(mockStreamMessage).toHaveBeenCalledTimes(1));
    expect(lastRequest()).toEqual(expect.objectContaining({ message: "second question" }));
  });

  it("offers retry on an interrupted response", async () => {
    setConversation([
      message("u1", "user", "long task"),
      message("a1", "assistant", "partial", { isInterrupted: true }),
    ]);
    render(<ChatPanel agentId="example-agent" conversationId="chat-1" />);
    expect(screen.getByText("Response was interrupted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockStreamMessage).toHaveBeenCalledTimes(1));
    expect(lastRequest()).toEqual(expect.objectContaining({ message: "long task" }));
  });
});

describe("retry is unavailable when it would be unsafe", () => {
  const expectNoRetry = () => {
    expect(screen.queryByRole("button", { name: "Retry this prompt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Regenerate response" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  };

  it("hides retry while a response is streaming", () => {
    mockStreaming = true;
    render(<ChatPanel agentId="example-agent" conversationId="chat-1" />);
    expectNoRetry();
  });

  it("hides retry in a read-only shared conversation", () => {
    render(<ChatPanel agentId="example-agent" conversationId="chat-1" readOnly readOnlyReason="shared_readonly" />);
    expectNoRetry();
  });

  it("hides retry in autonomous run history", () => {
    setConversation(
      [
        message("u1", "user", "run request", { autonomousRunId: "r1", autonomousExecutionContextId: "c1", autonomousMessageKind: "run_request" }),
        message("a1", "assistant", "run response", { autonomousRunId: "r1", autonomousExecutionContextId: "c1", autonomousMessageKind: "run_response" }),
      ],
      { source: "autonomous", task_id: "example-task" },
    );
    render(<ChatPanel agentId="example-agent" conversationId="chat-1" />);
    expectNoRetry();
  });
});
