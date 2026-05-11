/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import type { AgenticAppManifest } from "@/types/agentic-app";

jest.mock("@/lib/agentic-apps/store", () => {
  const actual = jest.requireActual<typeof import("@/lib/agentic-apps/store")>(
    "@/lib/agentic-apps/store",
  );
  return {
    ...actual,
    listAppPackages: jest.fn(),
    listAppInstallations: jest.fn(),
    appendWebhookDelivery: jest.fn(),
    appendPdpDecision: jest.fn(),
    appendAppTokenGrant: jest.fn(),
    userPassesAgenticAppAccessGates: jest.fn(() => true),
  };
});

const manifest: AgenticAppManifest = {
  id: "weather",
  displayName: "Weather",
  description: "Weather app",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/weather",
    origin: "http://localhost:3020",
  },
  surfaces: { showInHub: true },
  access: {
    tokenScopes: ["weather:read"],
    policyActions: [{ action: "webhook.github.repo-events", defaultEffect: "allow" }],
  },
  webhooks: [
    {
      provider: "github",
      channel: "repo-events",
      upstreamPath: "/webhooks/github",
      allowedMethods: ["POST"],
      verificationOwner: "app",
      preservedHeaders: ["x-github-event", "x-hub-signature-256"],
      maxBodyBytes: 1024,
      policyAction: "webhook.github.repo-events",
    },
  ],
  health: { endpoint: "/healthz" },
};

function storeMocks() {
  return jest.requireMock("@/lib/agentic-apps/store") as {
    listAppPackages: jest.Mock;
    listAppInstallations: jest.Mock;
    appendWebhookDelivery: jest.Mock;
    appendPdpDecision: jest.Mock;
    appendAppTokenGrant: jest.Mock;
  };
}

describe("agentic app webhook gateway", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NEXTAUTH_SECRET: "test-agentic-app-token-secret",
    };
    const store = storeMocks();
    store.listAppPackages.mockReset().mockResolvedValue([
      { packageId: "weather", source: "builtin", manifest },
    ]);
    store.listAppInstallations.mockReset().mockResolvedValue([
      {
        appId: "weather",
        packageId: "weather",
        installed: true,
        enabled: true,
        runtimeHealth: "healthy",
      },
    ]);
    store.appendWebhookDelivery.mockReset().mockResolvedValue(undefined);
    store.appendPdpDecision.mockReset().mockResolvedValue(undefined);
    store.appendAppTokenGrant.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("forwards raw body to the configured upstream with only preserved provider headers", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response("accepted", { status: 202 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { forwardAgenticAppWebhook } = await import("@/lib/agentic-apps/webhook-gateway");

    const res = await forwardAgenticAppWebhook({
      appId: "weather",
      provider: "github",
      channel: "repo-events",
      request: new Request("http://localhost/api/agentic-apps/webhooks/weather/github/repo-events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "push",
          "x-hub-signature-256": "sha256=abc",
          cookie: "should-not-forward",
          authorization: "Bearer attacker",
        },
        body: '{"ok":true}',
      }),
    });

    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3020/webhooks/github",
      expect.objectContaining({ method: "POST", body: expect.any(ArrayBuffer) }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("x-github-event")).toBe("push");
    expect(headers.get("x-hub-signature-256")).toBe("sha256=abc");
    expect(headers.has("cookie")).toBe(false);
    expect(headers.get("authorization") ?? "").toMatch(/^Bearer /);
  });

  it("rejects oversized webhook payloads before contacting upstream", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { forwardAgenticAppWebhook } = await import("@/lib/agentic-apps/webhook-gateway");

    const res = await forwardAgenticAppWebhook({
      appId: "weather",
      provider: "github",
      channel: "repo-events",
      request: new Request("http://localhost/api/agentic-apps/webhooks/weather/github/repo-events", {
        method: "POST",
        body: "x".repeat(2048),
      }),
    });

    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storeMocks().appendWebhookDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "weather", status: "dropped" }),
    );
  });
});
