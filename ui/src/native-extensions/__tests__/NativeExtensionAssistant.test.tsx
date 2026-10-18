import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { NativeExtensionAssistant } from "../NativeExtensionAssistant";

const createConversation = jest.fn();

jest.mock("@/store/chat-store", () => ({
  useChatStore: { getState: () => ({ createConversation }) },
}));

jest.mock("@/components/chat/DynamicAgentChatPanel", () => ({
  ChatPanel: () => <div data-testid="agent-chat" />,
}));

describe("NativeExtensionAssistant", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    createConversation.mockReset();
  });

  it("opens a host-owned assistant for the declared agent", async () => {
    createConversation.mockResolvedValue("example-conversation");
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { enabled: true, name: "Example Assistant" } }),
    } as Response);

    render(
      <NativeExtensionAssistant
        assistant={{ agentId: "agent-example", label: "Ask Example", name: "Example Assistant" }}
        extensionId="example-app"
        pathname="/example/detail"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask Example" }));
    expect(await screen.findByTestId("agent-chat")).toBeInTheDocument();
    expect(createConversation).toHaveBeenCalledWith("agent-example");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/dynamic-agents/agents/agent-example",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not render a chat when agent access is denied", async () => {
    createConversation.mockResolvedValue("example-conversation");
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: false } as Response);

    render(
      <NativeExtensionAssistant
        assistant={{ agentId: "agent-example", label: "Ask Example", name: "Example Assistant" }}
        extensionId="example-app"
        pathname="/example"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask Example" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("access was denied");
    expect(screen.queryByTestId("agent-chat")).not.toBeInTheDocument();
    expect(createConversation).not.toHaveBeenCalled();
  });

  it("clears a transient fetch error while reopening and only creates chat after access succeeds", async () => {
    createConversation.mockResolvedValue("example-conversation");
    let resolveRetry!: (response: Response) => void;
    const retry = new Promise<Response>((resolve) => { resolveRetry = resolve; });
    jest.spyOn(global, "fetch")
      .mockRejectedValueOnce(new Error("Temporary connection failure"))
      .mockImplementationOnce(() => retry);

    render(
      <NativeExtensionAssistant
        assistant={{ agentId: "agent-example", label: "Ask Example", name: "Example Assistant" }}
        extensionId="example-app"
        pathname="/example"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask Example" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporary connection failure");
    expect(createConversation).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start new assistant chat" })).toBeDisabled();

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close assistant" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask Example" }));
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Starting Ask Example…")).toBeInTheDocument();
    expect(createConversation).not.toHaveBeenCalled();

    await act(async () => {
      resolveRetry({
        ok: true,
        json: async () => ({ success: true, data: { enabled: true, name: "Example Assistant" } }),
      } as Response);
    });
    expect(await screen.findByTestId("agent-chat")).toBeInTheDocument();
    expect(createConversation).toHaveBeenCalledTimes(1);
  });

  it("never creates conversation history for a disabled agent, including retries", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { enabled: false } }),
    } as Response);
    render(
      <NativeExtensionAssistant
        assistant={{ agentId: "agent-example", label: "Ask Example", name: "Example Assistant" }}
        extensionId="example-app"
        pathname="/example"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask Example" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("access was denied");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close assistant" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask Example" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("access was denied");
    expect(screen.getByRole("button", { name: "Start new assistant chat" })).toBeDisabled();
    expect(createConversation).not.toHaveBeenCalled();
  });
});
