import { resolveUsableChatAgent } from "@/lib/chat-agent-selection";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("resolveUsableChatAgent", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("falls through a stale default to an agent the user can access", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/user/preferences") {
        return jsonResponse({
          success: true,
          data: {
            web_default_agent_id: "agent-weather-agent",
            platform_default_agent_id: null,
          },
        });
      }
      if (url === "/api/dynamic-agents/available") {
        return jsonResponse({
          success: true,
          data: [{ _id: "example-agent", name: "Example Agent", enabled: true }],
        });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    await expect(
      resolveUsableChatAgent({ requireAvailableAgent: true }),
    ).resolves.toEqual({
      id: "example-agent",
      name: "Example Agent",
      source: "first-available",
    });
  });

  it("fails closed when strict availability cannot be checked", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/user/preferences") {
        return jsonResponse({
          success: true,
          data: { platform_default_agent_id: "example-agent" },
        });
      }
      return jsonResponse({}, 503);
    }) as typeof fetch;

    await expect(
      resolveUsableChatAgent({ requireAvailableAgent: true }),
    ).rejects.toThrow("No dynamic agents are available");
  });

  it("selects an explicitly configured CAS-visible agent", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/user/preferences") {
        return jsonResponse({ success: true, data: {} });
      }
      if (url === "/api/dynamic-agents/available") {
        return jsonResponse({
          success: true,
          data: [
            { _id: "hello-world", name: "Hello World", enabled: true },
            { _id: "agent-speakers-collective", name: "Speakers Collective Agent", enabled: true },
          ],
        });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    await expect(
      resolveUsableChatAgent({
        requestedAgentId: "agent-speakers-collective",
        requireAvailableAgent: true,
      }),
    ).resolves.toEqual({
      id: "agent-speakers-collective",
      name: "Speakers Collective Agent",
      source: "configured",
    });
  });

  it("does not fall back when the configured agent is unavailable", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/user/preferences") {
        return jsonResponse({ success: true, data: {} });
      }
      if (url === "/api/dynamic-agents/available") {
        return jsonResponse({
          success: true,
          data: [{ _id: "hello-world", name: "Hello World", enabled: true }],
        });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    await expect(
      resolveUsableChatAgent({ requestedAgentId: "agent-speakers-collective" }),
    ).rejects.toThrow(
      'Configured agent "agent-speakers-collective" is unavailable or not authorized',
    );
  });
});
