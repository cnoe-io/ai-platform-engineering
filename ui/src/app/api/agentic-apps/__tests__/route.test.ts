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
  id: "kaleidoscope",
  displayName: "Kaleidoscope",
  description: "Explore software delivery data.",
  apiVersion: "1.0" as const,
  runtime: {
    kind: "proxied-next-zone" as const,
    mountPath: "/apps/kaleidoscope",
    origin: "http://kaleidoscope.caipe-dev.svc:80",
  },
  surfaces: {
    showInHub: true,
    showInTopNav: true,
    navOrder: 40,
  },
  access: {
    requiredRoles: ["user"],
    tokenScopes: ["kaleidoscope:read"],
  },
  assistant: {
    enabled: false,
    label: "Ask Kaleidoscope",
    agentName: "Kaleidoscope Assistant",
  },
  health: {
    endpoint: "/healthz",
  },
};

const installation = {
  appId: "kaleidoscope",
  packageId: "kaleidoscope",
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
      href: "/apps/kaleidoscope",
    });
    mockAgenticApps.getEnabledAgenticApps.mockReturnValue([]);
    mockAgenticApps.listAppInstallations.mockResolvedValue([installation]);
    mockAgenticApps.listAppPackages.mockResolvedValue([
      {
        packageId: "kaleidoscope",
        source: "helm",
        manifest,
      },
    ]);
    mockAgenticApps.userPassesAgenticAppAccessGates.mockReturnValue(true);
  });

  it("returns config-driven presentation fields at the top level for list consumers", async () => {
    const { GET } = await import("../route");

    const response = await GET(request());
    const body = await response.json();
    const [item] = body.data.items;

    expect(item).toEqual(
      expect.objectContaining({
        appId: "kaleidoscope",
        displayName: "Kaleidoscope",
        description: "Explore software delivery data.",
        href: "/apps/kaleidoscope",
        canLaunch: true,
        surfaces: {
          showInHub: true,
          showInTopNav: true,
          navOrder: 40,
        },
        assistantEnabled: false,
        assistantLabel: "Ask Kaleidoscope",
        assistantAgentName: "Kaleidoscope Assistant",
      }),
    );
    expect(item.package).toEqual(
      expect.objectContaining({
        displayName: "Kaleidoscope",
        description: "Explore software delivery data.",
      }),
    );
    expect(JSON.stringify(item)).not.toContain("kaleidoscope.caipe-dev.svc");
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
        displayName: "Kaleidoscope",
        description: "Explore software delivery data.",
        surfaces: manifest.surfaces,
        assistantEnabled: false,
      }),
    );
  });
});
