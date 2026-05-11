/**
 * @jest-environment jsdom
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ASSISTANT_CONTEXT_MESSAGE_TYPE } from "@/lib/agentic-apps/assistant-context";
import { AgenticAppEmbed } from "@/app/(app)/apps/embed/[appId]/AgenticAppEmbed";

const mockGetAgenticApps = jest.fn();
const mockChatPanel = jest.fn();

jest.mock("@/lib/api-client", () => ({
  apiClient: {
    getAgenticApps: (...args: unknown[]) => mockGetAgenticApps(...args),
  },
}));

jest.mock("@/components/chat/DynamicAgentChatPanel", () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    mockChatPanel(props);
    return <div data-testid="chat-panel" />;
  },
}));

describe("agentic app assistant bridge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAgenticApps.mockResolvedValue({
      items: [
        {
          appId: "weather",
          displayName: "Weather",
          description: "Forecasts",
          canLaunch: true,
          blockedReasons: [],
        },
      ],
    });
  });

  it("accepts postMessage context for the active embedded app and passes it to the host assistant", async () => {
    const user = userEvent.setup();
    render(<AgenticAppEmbed appId="weather" />);
    const iframe = await screen.findByTitle("Weather");

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: window,
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: window,
          data: {
            type: ASSISTANT_CONTEXT_MESSAGE_TYPE,
            version: "1.0",
            appId: "weather",
            context: {
              route: "/forecast",
              title: "San Jose Forecast",
              summary: "Rain risk is rising for Saturday.",
              suggestedPrompts: ["Should I move the event indoors?"],
            },
          },
        }),
      );
    });

    await user.click(screen.getByRole("button", { name: /ask caipe/i }));

    await waitFor(() =>
      expect(mockChatPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          clientContext: expect.objectContaining({
            appId: "weather",
            route: "/forecast",
            summary: "Rain risk is rising for Saturday.",
          }),
          suggestedPrompts: ["Should I move the event indoors?"],
        }),
      ),
    );
    expect(screen.getByText("San Jose Forecast")).toBeInTheDocument();
  });

  it("ignores rejected postMessage payloads", async () => {
    const user = userEvent.setup();
    render(<AgenticAppEmbed appId="weather" />);
    const iframe = await screen.findByTitle("Weather");
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: window,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: window,
          data: {
            type: ASSISTANT_CONTEXT_MESSAGE_TYPE,
            version: "1.0",
            appId: "finops",
            context: { route: "/forecast", summary: "Wrong app" },
          },
        }),
      );
    });
    await user.click(screen.getByRole("button", { name: /ask caipe/i }));

    expect(mockChatPanel).toHaveBeenCalledWith(
      expect.objectContaining({ clientContext: undefined }),
    );
  });

  it("uses a working FinOps assistant agent and opens chat from embedded app requests", async () => {
    mockGetAgenticApps.mockResolvedValue({
      items: [
        {
          appId: "finops",
          displayName: "FinOps",
          description: "Costs",
          canLaunch: true,
          blockedReasons: [],
        },
      ],
    });

    render(<AgenticAppEmbed appId="finops" />);
    const iframe = await screen.findByTitle("FinOps");
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: window,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          source: window,
          data: {
            type: "caipe.agenticApp.assistant.open.v1",
            version: "1.0",
            appId: "finops",
          },
        }),
      );
    });

    await waitFor(() =>
      expect(mockChatPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "agent-aws-cost-explorer",
        }),
      ),
    );
    expect(screen.getByRole("button", { name: /resize caipe assistant/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /assistant font size/i }));
    expect(mockChatPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fontScale: "default",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: /disable translucent assistant mode/i }));
    expect(mockChatPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        surface: "default",
      }),
    );
  });
});
