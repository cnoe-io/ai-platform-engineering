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

jest.mock("@/lib/agentic-apps/store", () => {
  const actual = jest.requireActual<typeof import("@/lib/agentic-apps/store")>(
    "@/lib/agentic-apps/store",
  );
  return {
    ...actual,
    listAppPackages: jest.fn(),
    listAppInstallations: jest.fn(),
  };
});

function sessionMock(): jest.Mock {
  return (require("next-auth") as { getServerSession: jest.Mock }).getServerSession;
}

const finopsManifest: AgenticAppManifest = {
  id: "finops",
  displayName: "FinOps Dashboard",
  description: "Cloud cost",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/finops",
    origin: "http://localhost:3010",
  },
  surfaces: { showInHub: true },
  access: { requiredRoles: ["user"], tokenScopes: ["finops:read"] },
  health: { endpoint: "/healthz" },
};

function primeMongoEnv(configured: boolean) {
  if (configured) {
    process.env.MONGODB_URI = "mongodb://localhost:27017";
    process.env.MONGODB_DATABASE = "test";
  } else {
    delete process.env.MONGODB_URI;
    delete process.env.MONGODB_DATABASE;
  }
}

describe("GET /api/agentic-apps", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.SSO_ENABLED = "true";
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    mongoGate.configured = true;
    primeMongoEnv(true);
    process.env.AGENTIC_APPS_ENABLED = "finops";
    process.env.AGENTIC_APP_FINOPS_ORIGIN = "http://localhost:3010";

    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
    };
    store.listAppPackages.mockReset().mockResolvedValue([]);
    store.listAppInstallations.mockReset().mockResolvedValue([]);

    sessionMock().mockReset();
    sessionMock().mockResolvedValue({
      user: { email: "user@example.com", name: "User" },
      role: "user",
      canViewAdmin: false,
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns Hub items from marketplace installs", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
    };
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "finops-instance",
        packageId: "finops",
        installed: true,
        enabled: true,
      },
    ]);
    store.listAppPackages.mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest: finopsManifest },
    ]);

    const { GET } = await import("@/app/api/agentic-apps/route");
    const res = await GET(new Request("http://localhost/api/agentic-apps"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([
      expect.objectContaining({
        appId: "finops-instance",
        displayName: "FinOps Dashboard",
        href: "/apps/finops",
        canLaunch: true,
      }),
    ]);
  });

  it("returns 404 when the host install toggle is disabled", async () => {
    delete process.env.AGENTIC_APPS_INSTALL_ENABLED;

    const { GET } = await import("@/app/api/agentic-apps/route");
    const res = await GET(new Request("http://localhost/api/agentic-apps"));

    expect(res.status).toBe(404);
  });
});
