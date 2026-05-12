/**
 * @jest-environment jsdom
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { render, screen, waitFor } from "@testing-library/react";

import { AgenticAppEmbed } from "@/app/(app)/apps/embed/[appId]/AgenticAppEmbed";

const mockGetAgenticApps = jest.fn();

jest.mock("@/lib/api-client", () => ({
  apiClient: {
    getAgenticApps: (...args: unknown[]) => mockGetAgenticApps(...args),
  },
}));

jest.mock("@/components/chat/DynamicAgentChatPanel", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

describe("agentic app embed shell", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAgenticApps.mockResolvedValue({
      items: [
        {
          appId: "demo-external",
          displayName: "Demo External App",
          description: "External app",
          canLaunch: true,
          blockedReasons: [],
          assistantEnabled: true,
        },
      ],
    });
  });

  it("keeps CAIPE ownership of chrome and assistant controls while app content stays in iframe", async () => {
    render(<AgenticAppEmbed appId="demo-external" />);

    expect(await screen.findByText("Demo External App")).toBeInTheDocument();
    expect(screen.getByTitle("Demo External App")).toHaveAttribute("src", "/apps/demo-external");
    expect(screen.getByRole("button", { name: /ask caipe/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open in new tab/i })).not.toBeInTheDocument();
  });

  it("does not mount Ask CAIPE when the app manifest disables assistant support", async () => {
    mockGetAgenticApps.mockResolvedValue({
      items: [
        {
          appId: "demo-catalog-app",
          displayName: "Demo Catalog App",
          description: "External catalog app",
          canLaunch: true,
          blockedReasons: [],
          assistantEnabled: false,
        },
      ],
    });

    render(<AgenticAppEmbed appId="demo-catalog-app" />);

    expect(await screen.findByText("Demo Catalog App")).toBeInTheDocument();
    expect(screen.getByTitle("Demo Catalog App")).toHaveAttribute("src", "/apps/demo-catalog-app");
    expect(screen.queryByRole("button", { name: /ask caipe/i })).not.toBeInTheDocument();
  });

  it("uses the manifest-provided assistantLabel for the floating bubble", async () => {
    mockGetAgenticApps.mockResolvedValue({
      items: [
        {
          appId: "finops",
          displayName: "FinOps Command Center",
          description: "AWS cost intelligence",
          canLaunch: true,
          blockedReasons: [],
          assistantEnabled: true,
          assistantLabel: "Ask FinOps",
          assistantAgentName: "FinOps Assistant",
        },
      ],
    });

    render(<AgenticAppEmbed appId="finops" />);

    expect(await screen.findByText("FinOps Command Center")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open ask finops/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^ask caipe$/i })).not.toBeInTheDocument();
  });

  it("redirects to login with the current embed path when the app list requires auth", async () => {
    const onUnauthorized = jest.fn();
    window.history.pushState({}, "", "/apps/embed/demo-external?tab=projects#top");
    mockGetAgenticApps.mockRejectedValue(new Error("HTTP 401"));

    render(<AgenticAppEmbed appId="demo-external" onUnauthorized={onUnauthorized} />);

    await waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalledWith(
        "/login?callbackUrl=%2Fapps%2Fembed%2Fdemo-external%3Ftab%3Dprojects%23top",
      );
    });
  });
});
