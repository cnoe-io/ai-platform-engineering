import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DmAgentPreferencePanel } from "../DmAgentPreferencePanel";

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function mockFetch(handler: FetchHandler) {
  global.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    return handler(u, init);
  }) as unknown as typeof global.fetch;
}

const agentsPayload = {
  success: true,
  data: {
    agents: [
      { id: "agent-x", name: "Agent X", description: "Does X" },
      { id: "agent-y", name: "Agent Y", description: "Does Y" },
      { id: "agent-z", name: "Agent Z", description: "Does Z" },
    ],
    total: 3,
    page: 1,
    page_size: 100,
  },
};

describe("DmAgentPreferencePanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the saved preference highlighted and lists accessible agents", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/user/preferences")) {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { dm_default_agent_id: "agent-y" },
          }),
        );
      }
      if (url.startsWith("/api/user/accessible-agents")) {
        return Promise.resolve(jsonResponse(200, agentsPayload));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    render(<DmAgentPreferencePanel />);

    await waitFor(() => {
      expect(screen.getByText("Agent X")).toBeInTheDocument();
      expect(screen.getByText("Agent Y")).toBeInTheDocument();
      expect(screen.getByText("Agent Z")).toBeInTheDocument();
    });

    const radioY = screen.getByLabelText(/Agent Y/i) as HTMLInputElement;
    expect(radioY.checked).toBe(true);
  });

  it("renders a deployment-default option, selected when no preference is saved", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/user/preferences")) {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { dm_default_agent_id: null },
          }),
        );
      }
      if (url.startsWith("/api/user/accessible-agents")) {
        return Promise.resolve(jsonResponse(200, agentsPayload));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    render(<DmAgentPreferencePanel />);

    await waitFor(() => {
      expect(screen.getByLabelText(/deployment default/i)).toBeInTheDocument();
    });
    const radio = screen.getByLabelText(/deployment default/i) as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });

  it("saves a new preference when the user picks an agent", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    mockFetch((url, init) => {
      calls.push({ url, init });
      if (url.startsWith("/api/user/preferences") && init?.method === "PUT") {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { dm_default_agent_id: "agent-x" },
          }),
        );
      }
      if (url.startsWith("/api/user/preferences")) {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { dm_default_agent_id: null },
          }),
        );
      }
      if (url.startsWith("/api/user/accessible-agents")) {
        return Promise.resolve(jsonResponse(200, agentsPayload));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    render(<DmAgentPreferencePanel />);

    await waitFor(() => {
      expect(screen.getByText("Agent X")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/Agent X/i));

    await waitFor(() => {
      const putCall = calls.find(
        (c) =>
          c.url.startsWith("/api/user/preferences") && c.init?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      expect(JSON.parse((putCall!.init!.body as string) ?? "{}")).toEqual({
        dm_default_agent_id: "agent-x",
      });
    });
  });

  it("clears the preference when the user picks deployment default", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    mockFetch((url, init) => {
      calls.push({ url, init });
      if (url.startsWith("/api/user/preferences") && init?.method === "PUT") {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { dm_default_agent_id: null },
          }),
        );
      }
      if (url.startsWith("/api/user/preferences")) {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { dm_default_agent_id: "agent-x" },
          }),
        );
      }
      if (url.startsWith("/api/user/accessible-agents")) {
        return Promise.resolve(jsonResponse(200, agentsPayload));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    render(<DmAgentPreferencePanel />);

    await waitFor(() => {
      expect(screen.getByText("Agent X")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/deployment default/i));

    await waitFor(() => {
      const putCall = calls.find(
        (c) =>
          c.url.startsWith("/api/user/preferences") && c.init?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      expect(JSON.parse((putCall!.init!.body as string) ?? "{}")).toEqual({
        dm_default_agent_id: null,
      });
    });
  });

  it("shows an empty-state message when the user has no accessible agents", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/user/preferences")) {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { dm_default_agent_id: null },
          }),
        );
      }
      if (url.startsWith("/api/user/accessible-agents")) {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { agents: [], total: 0, page: 1, page_size: 100 },
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    render(<DmAgentPreferencePanel />);

    await waitFor(() => {
      expect(screen.getByText(/no agents available/i)).toBeInTheDocument();
    });
  });

  it("shows a retry button when the agents fetch fails", async () => {
    let agentsCallCount = 0;
    mockFetch((url) => {
      if (url.startsWith("/api/user/preferences")) {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { dm_default_agent_id: null },
          }),
        );
      }
      if (url.startsWith("/api/user/accessible-agents")) {
        agentsCallCount += 1;
        if (agentsCallCount === 1) {
          return Promise.resolve(jsonResponse(500, { error: "server" }));
        }
        return Promise.resolve(jsonResponse(200, agentsPayload));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    render(<DmAgentPreferencePanel />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(screen.getByText("Agent X")).toBeInTheDocument();
    });
    expect(agentsCallCount).toBe(2);
  });

  it("surfaces a friendly error if saving fails", async () => {
    mockFetch((url, init) => {
      if (url.startsWith("/api/user/preferences") && init?.method === "PUT") {
        return Promise.resolve(
          jsonResponse(403, {
            success: false,
            error: "You do not have permission to use the selected agent.",
            code: "FORBIDDEN_AGENT",
          }),
        );
      }
      if (url.startsWith("/api/user/preferences")) {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            data: { dm_default_agent_id: null },
          }),
        );
      }
      if (url.startsWith("/api/user/accessible-agents")) {
        return Promise.resolve(jsonResponse(200, agentsPayload));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    render(<DmAgentPreferencePanel />);

    await waitFor(() => {
      expect(screen.getByText("Agent X")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/Agent X/i));

    await waitFor(() => {
      expect(
        screen.getByText(/do not have permission/i),
      ).toBeInTheDocument();
    });
  });
});
