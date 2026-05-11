/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import type { AgenticAppManifest } from "@/types/agentic-app";

jest.mock("next-auth", () => ({
  __esModule: true,
  getServerSession: jest.fn(),
}));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));
jest.mock("@/lib/config", () => ({
  getConfig: jest.fn((key: string) => (key === "ssoEnabled" ? true : false)),
}));

const mongoGate = { configured: true };
jest.mock("@/lib/mongodb", () => ({
  get isMongoDBConfigured() {
    return mongoGate.configured;
  },
  getCollection: jest.fn().mockResolvedValue({
    findOne: jest.fn().mockResolvedValue(null),
  }),
}));

jest.mock("@/lib/agentic-apps/store", () => ({
  listAppPackages: jest.fn(),
  listAppInstallations: jest.fn(),
  appendPdpDecision: jest.fn(),
  appendAppTokenGrant: jest.fn(),
  userPassesAgenticAppAccessGates: jest.fn((manifestArg, context) => {
    const requiredRoles = manifestArg.access.requiredRoles ?? [];
    return requiredRoles.length === 0 || requiredRoles.some((role: string) => context.roles.includes(role));
  }),
}));

function sessionMock(): jest.Mock {
  return (require("next-auth") as { getServerSession: jest.Mock }).getServerSession;
}

const manifest: AgenticAppManifest = {
  id: "finops",
  displayName: "FinOps",
  description: "Cost controls",
  apiVersion: "1.0",
  runtime: { kind: "proxied-next-zone", mountPath: "/apps/finops", origin: "http://localhost:3010" },
  surfaces: { showInHub: true },
  access: { requiredRoles: ["user"], tokenScopes: ["finops:read", "agents:invoke"] },
  health: { endpoint: "/healthz" },
};

describe("POST /api/agentic-apps/[appId]/authorize", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      AGENTIC_APPS_INSTALL_ENABLED: "true",
      NEXTAUTH_SECRET: "test-agentic-app-token-secret",
    };
    mongoGate.configured = true;
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
      appendPdpDecision: jest.Mock;
      appendAppTokenGrant: jest.Mock;
    };
    store.listAppPackages.mockReset().mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest },
    ]);
    store.listAppInstallations.mockReset().mockResolvedValue([
      { appId: "finops", packageId: "finops", installed: true, enabled: true, runtimeHealth: "healthy" },
    ]);
    store.appendPdpDecision.mockReset().mockResolvedValue(undefined);
    store.appendAppTokenGrant.mockReset().mockResolvedValue(undefined);
    sessionMock().mockReset().mockResolvedValue({
      user: { email: "user@example.com", name: "User" },
      role: "user",
      sub: "user-123",
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns a scoped token for allowed app-owned authorization", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      appendPdpDecision: jest.Mock;
      appendAppTokenGrant: jest.Mock;
    };
    const { POST } = await import("@/app/api/agentic-apps/[appId]/authorize/route");
    const res = await POST(
      new Request("http://localhost/api/agentic-apps/finops/authorize", {
        method: "POST",
        headers: { "content-type": "application/json", "x-correlation-id": "corr-1" },
        body: JSON.stringify({ action: "repo:read", scopes: ["finops:read", "admin:root"] }),
      }) as never,
      { params: Promise.resolve({ appId: "finops" }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^ey/);
    expect(body.scopes).toEqual(["finops:read"]);
    expect(store.appendPdpDecision).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "finops", correlationId: "corr-1", effect: "allow" }),
    );
    expect(store.appendAppTokenGrant).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "finops", correlationId: "corr-1", scopes: ["finops:read"] }),
    );
  });

  it("denies when app access checks fail", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppInstallations: jest.Mock;
      appendPdpDecision: jest.Mock;
      appendAppTokenGrant: jest.Mock;
    };
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "finops",
        packageId: "finops",
        installed: true,
        enabled: true,
        runtimeHealth: "healthy",
        accessOverrides: { requiredRoles: ["admin"] },
      },
    ]);
    const { POST } = await import("@/app/api/agentic-apps/[appId]/authorize/route");
    const res = await POST(
      new Request("http://localhost/api/agentic-apps/finops/authorize", {
        method: "POST",
        body: JSON.stringify({ action: "repo:read" }),
      }) as never,
      { params: Promise.resolve({ appId: "finops" }) },
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "app_unauthorized" });
    expect(store.appendPdpDecision).not.toHaveBeenCalled();
    expect(store.appendAppTokenGrant).not.toHaveBeenCalled();
  });
});
