/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockAgenticApps = {
  evaluateAppAccess: jest.fn(),
  getEnabledAgenticApps: jest.fn(),
  listAppInstallations: jest.fn(),
  listAppPackages: jest.fn(),
  userPassesAgenticAppAccessGates: jest.fn(),
  evaluateCasCompatibility: jest.fn(),
};

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: jest.fn(async () => ({
    user: { email: "user@example.com", name: "Example User", role: "user" },
    session: { role: "user" },
  })),
  successResponse: (data: unknown) => Response.json({ success: true, data }),
  withErrorHandler: (handler: unknown) => handler,
}));

jest.mock("@/lib/agentic-apps/access", () => ({
  buildEffectiveAppsUserContext: jest.fn(() => ({
    email: "user@example.com",
    roles: ["user"],
    groups: [],
  })),
  evaluateAppAccess: (...args: unknown[]) => mockAgenticApps.evaluateAppAccess(...args),
}));

jest.mock("@/lib/agentic-apps/cas-compat", () => ({
  evaluateAgenticAppCasCompatibility: (...args: unknown[]) =>
    mockAgenticApps.evaluateCasCompatibility(...args),
}));

jest.mock("@/lib/agentic-apps/registry", () => ({
  getEnabledAgenticApps: () => mockAgenticApps.getEnabledAgenticApps(),
  isAgenticAppsInstallEnabled: jest.fn(() => true),
}));

jest.mock("@/lib/agentic-apps/store", () => ({
  isUsableAccessRecord: jest.fn(() => true),
  listAppInstallations: () => mockAgenticApps.listAppInstallations(),
  listAppPackages: () => mockAgenticApps.listAppPackages(),
  userPassesAgenticAppAccessGates: (...args: unknown[]) =>
    mockAgenticApps.userPassesAgenticAppAccessGates(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
}));

const manifest = {
  id: "example-app",
  displayName: "Example App",
  description: "Explore software delivery data.",
  apiVersion: "1.0" as const,
  runtime: {
    kind: "proxied-next-zone" as const,
    mountPath: "/apps/example-app",
    origin: "http://example-app.example.test:80",
  },
  surfaces: {
    showInHub: true,
    showInTopNav: true,
    navOrder: 40,
  },
  access: {
    requiredRoles: ["user"],
    tokenScopes: ["example-app:read"],
  },
  assistant: {
    enabled: false,
    agentId: "example-agent",
    label: "Ask Example",
    agentName: "Example Assistant",
  },
  health: {
    endpoint: "/healthz",
  },
};

const installation = {
  appId: "example-app",
  packageId: "example-app",
  installed: true,
  enabled: true,
  visible: true,
};

function request(): NextRequest {
  return new NextRequest("http://localhost/api/agentic-apps");
}

describe("GET /api/agentic-apps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAgenticApps.evaluateAppAccess.mockReturnValue({
      canLaunch: true,
      blockedReasons: [],
      href: "/apps/example-app",
    });
    mockAgenticApps.getEnabledAgenticApps.mockReturnValue([]);
    mockAgenticApps.listAppInstallations.mockResolvedValue([installation]);
    mockAgenticApps.listAppPackages.mockResolvedValue([
      {
        packageId: "example-app",
        source: "helm",
        manifest,
      },
    ]);
    mockAgenticApps.userPassesAgenticAppAccessGates.mockReturnValue(true);
    mockAgenticApps.evaluateCasCompatibility.mockResolvedValue({
      mode: "enforce",
      casDecision: "ALLOW",
      effectiveEffect: "allow",
    });
  });

  it("returns config-driven presentation fields at the top level for list consumers", async () => {
    const { GET } = await import("../route");

    const response = await GET(request());
    const body = await response.json();
    const [item] = body.data.items;

    expect(item).toEqual(
      expect.objectContaining({
        appId: "example-app",
        displayName: "Example App",
        description: "Explore software delivery data.",
        href: "/apps/example-app",
        canLaunch: true,
        surfaces: {
          showInHub: true,
          showInTopNav: true,
          navOrder: 40,
        },
        assistantEnabled: false,
        assistantAgentId: "example-agent",
        assistantLabel: "Ask Example",
        assistantAgentName: "Example Assistant",
      }),
    );
    expect(item.package).toEqual(
      expect.objectContaining({
        displayName: "Example App",
        description: "Explore software delivery data.",
      }),
    );
    expect(JSON.stringify(item)).not.toContain("example-app.example.test");
    expect(JSON.stringify(item)).not.toContain("/healthz");
  });

  it("uses the same flat presentation contract for built-in fallbacks", async () => {
    mockAgenticApps.listAppInstallations.mockResolvedValue([]);
    mockAgenticApps.listAppPackages.mockResolvedValue([]);
    mockAgenticApps.getEnabledAgenticApps.mockReturnValue([manifest]);

    const { GET } = await import("../route");
    const response = await GET(request());
    const body = await response.json();

    expect(body.data.items[0]).toEqual(
      expect.objectContaining({
        displayName: "Example App",
        description: "Explore software delivery data.",
        surfaces: manifest.surfaces,
        assistantEnabled: false,
      }),
    );
  });

  it("uses the CAS launch decision for the catalog card", async () => {
    const casManifest = {
      ...manifest,
      authorization: { resourceType: "agentic_app" as const, launchAction: "use" as const },
    };
    mockAgenticApps.listAppPackages.mockResolvedValue([
      { packageId: "example-app", source: "helm", manifest: casManifest },
    ]);
    mockAgenticApps.evaluateCasCompatibility.mockImplementation(
      async (input: { action?: string }) =>
        input.action === "use"
          ? {
              mode: "enforce",
              casDecision: "DENY",
              casReason: "NO_CAPABILITY",
              effectiveEffect: "deny",
            }
          : {
              mode: "enforce",
              casDecision: "ALLOW",
              effectiveEffect: "allow",
            },
    );

    const { GET } = await import("../route");
    const response = await GET(request());
    const body = await response.json();

    expect(body.data.items[0]).toEqual(
      expect.objectContaining({
        canLaunch: false,
        blockedReasons: ["unauthorized"],
        blockedReason: "unauthorized",
      }),
    );
    expect(mockAgenticApps.evaluateCasCompatibility).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "example-app",
        localEffect: "allow",
      }),
    );
  });

  it("omits apps when CAS denies discovery", async () => {
    const casManifest = {
      ...manifest,
      authorization: { resourceType: "agentic_app" as const, launchAction: "use" as const },
    };
    mockAgenticApps.listAppPackages.mockResolvedValue([
      { packageId: "example-app", source: "helm", manifest: casManifest },
    ]);
    mockAgenticApps.evaluateCasCompatibility.mockImplementation(
      async (input: { action?: string }) => ({
        mode: "enforce",
        casDecision: input.action === "read" ? "DENY" : "ALLOW",
        effectiveEffect: input.action === "read" ? "deny" : "allow",
      }),
    );

    const { GET } = await import("../route");
    const response = await GET(request());
    const body = await response.json();

    expect(body.data.items).toEqual([]);
  });
});
