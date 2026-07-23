/**
 * @jest-environment jsdom
 */

import { fireEvent,render,screen,waitFor } from "@testing-library/react";

import { UserDefaultAgentsPanel } from "../UserDefaultAgentsPanel";

const AGENTS = [
  { id: "sre",name: "Basic SRE",description: "Handles SRE workflows" },
  { id: "kb",name: "Knowledge Base Agent",description: "Answers from knowledge bases" },
];

interface MockOptions {
  failWrites?: boolean;
  integrations?: { slack: boolean;webex: boolean };
  platformDefault?: string | null;
  preferences?: {
    slack_default_agent_id?: string | null;
    web_default_agent_id?: string | null;
    webex_default_agent_id?: string | null;
  };
}

function installFetchMock({
  failWrites = false,
  integrations = { slack: true,webex: true },
  platformDefault = "sre",
  preferences = {},
}: MockOptions = {}): jest.Mock {
  const mock = jest.fn(async (input: RequestInfo | URL,init?: RequestInit) => {
    const path = String(input);
    if (path.includes("/api/user/accessible-agents")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { agents: AGENTS,total: AGENTS.length,page: 1,page_size: 100 },
        }),
      } as Response;
    }
    if (path.includes("/api/user/preferences") && init?.method === "PUT") {
      return {
        ok: !failWrites,
        status: failWrites ? 503 : 200,
        json: async () => failWrites
          ? ({ success: false,error: "Preference service unavailable" })
          : ({ success: true,data: {} }),
      } as Response;
    }
    if (path.includes("/api/user/preferences")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            platform_default_agent_id: platformDefault,
            web_default_agent_id: null,
            slack_default_agent_id: null,
            webex_default_agent_id: null,
            integrations,
            ...preferences,
          },
        }),
      } as Response;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  global.fetch = mock;
  return mock;
}

describe("UserDefaultAgentsPanel",() => {
  beforeEach(() => {
    jest.clearAllMocks();
    installFetchMock();
  });

  it("shows the resolved platform fallback on every connected surface",async () => {
    render(<UserDefaultAgentsPanel />);

    expect(await screen.findByRole("button",{ name: "Web default agent" })).toHaveTextContent(
      "Use platform default (Basic SRE)",
    );
    expect(screen.getByRole("button",{ name: "Slack default agent" })).toHaveTextContent(
      "Use platform default (Basic SRE)",
    );
    expect(screen.getByRole("button",{ name: "Webex default agent" })).toHaveTextContent(
      "Use platform default (Basic SRE)",
    );
    expect(screen.queryByRole("button",{ name: /save personal default agents/i })).not.toBeInTheDocument();
  });

  it("auto-saves Slack and Webex independently on selection",async () => {
    const fetchMock = installFetchMock();
    render(<UserDefaultAgentsPanel />);

    fireEvent.click(await screen.findByRole("button",{ name: "Slack default agent" }));
    fireEvent.click(await screen.findByRole("option",{ name: "Knowledge Base Agent" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/user/preferences",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ slack_default_agent_id: "kb" }),
        }),
      );
    });

    fireEvent.click(screen.getByRole("button",{ name: "Webex default agent" }));
    fireEvent.click(await screen.findByRole("option",{ name: "Knowledge Base Agent" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/user/preferences",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ webex_default_agent_id: "kb" }),
        }),
      );
    });
  });

  it("clears one override back to the platform default immediately",async () => {
    const fetchMock = installFetchMock({
      integrations: { slack: true,webex: false },
      preferences: { slack_default_agent_id: "kb" },
    });
    render(<UserDefaultAgentsPanel />);

    const slack = await screen.findByRole("button",{ name: "Slack default agent" });
    fireEvent.click(slack);
    fireEvent.click(await screen.findByRole("option",{ name: /Use platform default/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/user/preferences",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ slack_default_agent_id: null }),
        }),
      );
    });
    expect(slack).toHaveTextContent("Use platform default (Basic SRE)");
  });

  it("rolls back only the failed surface and exposes retry",async () => {
    installFetchMock({ failWrites: true,integrations: { slack: false,webex: false } });
    render(<UserDefaultAgentsPanel />);

    const web = await screen.findByRole("button",{ name: "Web default agent" });
    fireEvent.click(web);
    fireEvent.click(await screen.findByRole("option",{ name: "Knowledge Base Agent" }));

    await waitFor(() => {
      expect(web).toHaveTextContent("Use platform default (Basic SRE)");
      expect(screen.getByText("Preference service unavailable")).toBeInTheDocument();
      expect(screen.getByRole("button",{ name: "Retry" })).toBeInTheDocument();
    });
  });

  it("suppresses writes when disabled",async () => {
    const fetchMock = installFetchMock();
    render(<UserDefaultAgentsPanel disabled />);

    expect(await screen.findByRole("button",{ name: "Web default agent" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/user/preferences",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
