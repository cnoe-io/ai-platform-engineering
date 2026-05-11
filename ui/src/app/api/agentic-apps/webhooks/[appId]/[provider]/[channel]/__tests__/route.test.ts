/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

jest.mock("@/lib/agentic-apps/webhook-gateway", () => ({
  forwardAgenticAppWebhook: jest.fn(),
}));

describe("generic agentic app webhook route", () => {
  beforeEach(() => {
    const gateway = jest.requireMock("@/lib/agentic-apps/webhook-gateway") as {
      forwardAgenticAppWebhook: jest.Mock;
    };
    gateway.forwardAgenticAppWebhook.mockReset();
  });

  it("delegates POST requests to the webhook gateway", async () => {
    const gateway = jest.requireMock("@/lib/agentic-apps/webhook-gateway") as {
      forwardAgenticAppWebhook: jest.Mock;
    };
    gateway.forwardAgenticAppWebhook.mockResolvedValue(new Response("ok", { status: 202 }));

    const { POST } = await import("../route");
    const req = new Request("http://localhost/api/agentic-apps/webhooks/weather/github/repo-events", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req, {
      params: Promise.resolve({
        appId: "weather",
        provider: "github",
        channel: "repo-events",
      }),
    });

    expect(res.status).toBe(202);
    expect(gateway.forwardAgenticAppWebhook).toHaveBeenCalledWith({
      appId: "weather",
      provider: "github",
      channel: "repo-events",
      request: req,
    });
  });

  it("delegates PUT requests to the webhook gateway", async () => {
    const gateway = jest.requireMock("@/lib/agentic-apps/webhook-gateway") as {
      forwardAgenticAppWebhook: jest.Mock;
    };
    gateway.forwardAgenticAppWebhook.mockResolvedValue(Response.json({ ok: true }));

    const { PUT } = await import("../route");
    const res = await PUT(
      new Request("http://localhost/api/agentic-apps/webhooks/weather/acme/sync", {
        method: "PUT",
        body: "{}",
      }),
      {
        params: Promise.resolve({
          appId: "weather",
          provider: "acme",
          channel: "sync",
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(gateway.forwardAgenticAppWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "weather", provider: "acme", channel: "sync" }),
    );
  });

  it.each([
    ["accepted", 202, { ok: true }],
    ["denied", 403, { error: "pdp_denied" }],
    ["unregistered", 404, { error: "webhook_not_found" }],
    ["too-large", 413, { error: "payload_too_large" }],
    ["upstream-unavailable", 502, { error: "upstream_unavailable" }],
  ])("returns gateway status for %s deliveries", async (_name, status, body) => {
    const gateway = jest.requireMock("@/lib/agentic-apps/webhook-gateway") as {
      forwardAgenticAppWebhook: jest.Mock;
    };
    gateway.forwardAgenticAppWebhook.mockResolvedValue(Response.json(body, { status }));

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/agentic-apps/webhooks/weather/github/repo-events", {
        method: "POST",
        body: "{}",
      }),
      {
        params: Promise.resolve({
          appId: "weather",
          provider: "github",
          channel: "repo-events",
        }),
      },
    );

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });
});
