/** @jest-environment node */

import { NextRequest } from "next/server";

import type { ConfiguredAgenticApp } from "@/types/agentic-app";

const mockGetAuthenticatedUser = jest.fn();
const mockLoadConfiguredAgenticApps = jest.fn();
const mockEvaluateAgenticAppCasCompatibility = jest.fn();
const mockListAppInstallations = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  ApiError: class ApiError extends Error {
    statusCode = 401;
    code = "UNAUTHORIZED";
  },
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

jest.mock("@/lib/agentic-apps/config", () => ({
  isAgenticAppsEnabled: () => true,
  loadConfiguredAgenticApps: () => mockLoadConfiguredAgenticApps(),
}));

jest.mock("@/lib/agentic-apps/cas-compat", () => ({
  evaluateAgenticAppCasCompatibility: (...args: unknown[]) =>
    mockEvaluateAgenticAppCasCompatibility(...args),
}));

jest.mock("@/lib/agentic-apps/store", () => ({
  listAppInstallations: () => mockListAppInstallations(),
}));

jest.mock("@/lib/mongodb", () => ({ isMongoDBConfigured: true }));

import { GET } from "./route";

const configuredApp: ConfiguredAgenticApp = {
  manifest: {
    id: "example-app",
    displayName: "Example App",
    description: "Example",
    apiVersion: "1.0",
    runtime: {
      kind: "proxied-next-zone",
      origin: "https://app.example.test",
      mountPath: "/apps/example-app",
    },
    authorization: { resourceType: "agentic_app", launchAction: "use" },
    surfaces: { showInHub: true },
    access: {
      requiredRoles: ["user"],
      tokenScopes: ["example:read"],
      policyActions: [{ action: "proxy:GET", defaultEffect: "allow" }],
    },
  },
  installation: {
    appId: "example-app",
    packageId: "example-app",
    installed: true,
    enabled: true,
    visible: true,
  },
};

describe("External Apps catalog API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthenticatedUser.mockResolvedValue({
      user: { email: "test-user@example.com", role: "user" },
      session: { sub: "stable-subject", role: "user" },
    });
    mockLoadConfiguredAgenticApps.mockReturnValue([configuredApp]);
    mockListAppInstallations.mockResolvedValue([
      {
        appId: "example-app",
        packageId: "example-app",
        installed: true,
        enabled: true,
        createdBy: "test-user@example.com",
        visibility: "private",
      },
    ]);
    mockEvaluateAgenticAppCasCompatibility.mockImplementation(
      async ({ action }: { action: string }) => ({
        mode: "enforce",
        casDecision: action === "manage" ? "DENY" : "ALLOW",
        casReason: action === "manage" ? "NO_CAPABILITY" : undefined,
        effectiveEffect: action === "manage" ? "deny" : "allow",
      }),
    );
  });

  it("returns CAS-visible apps with persisted sharing metadata", async () => {
    const response = await GET(new NextRequest("https://host.example/api/agentic-apps"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([
      expect.objectContaining({
        appId: "example-app",
        canLaunch: true,
        canManage: false,
        sharingEnabled: true,
        visibility: "private",
        createdBy: "test-user@example.com",
      }),
    ]);
  });

  it("omits apps when CAS denies read", async () => {
    mockEvaluateAgenticAppCasCompatibility.mockResolvedValue({
      mode: "enforce",
      casDecision: "DENY",
      casReason: "NO_CAPABILITY",
      effectiveEffect: "deny",
    });

    const response = await GET(new NextRequest("https://host.example/api/agentic-apps"));

    await expect(response.json()).resolves.toEqual({ items: [] });
  });
});
