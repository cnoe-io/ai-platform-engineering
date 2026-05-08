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

const finopsManifestAuthorized: AgenticAppManifest = {
  id: "finops",
  displayName: "FinOps Dashboard",
  description: "Cloud cost",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/finops",
    origin: "http://localhost:3010",
  },
  surfaces: { showInHub: true, navOrder: 10 },
  access: { requiredRoles: ["user"], tokenScopes: ["finops:read"] },
  health: { endpoint: "/healthz" },
  agents: [
    { id: "a1", displayName: "Analyst", required: true },
  ],
};

const finopsManifestAdminOnly: AgenticAppManifest = {
  ...finopsManifestAuthorized,
  access: { requiredRoles: ["admin"], tokenScopes: ["finops:read"] },
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

function userSession() {
  return {
    user: { email: "user@example.com", name: "User" },
    role: "user",
    canViewAdmin: false,
  };
}

describe("user-facing agentic-apps APIs", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.SSO_ENABLED = "true";
    mongoGate.configured = true;
    primeMongoEnv(true);
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";

    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
    };
    store.listAppPackages.mockReset().mockResolvedValue([]);
    store.listAppInstallations.mockReset().mockResolvedValue([]);

    sessionMock().mockReset();
    sessionMock().mockResolvedValue(null);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("GET /api/agentic-apps returns Hub-ready installed apps with canLaunch true for authorized user", async () => {
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
        updatedAt: "2026-05-07T12:00:00.000Z",
        runtimeHealth: "healthy",
      },
    ]);
    store.listAppPackages.mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest: finopsManifestAuthorized },
    ]);

    sessionMock().mockResolvedValue(userSession());

    const { GET } = await import("@/app/api/agentic-apps/route");
    const res = await GET(new Request("http://localhost/api/agentic-apps"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    const row = body.items[0];
    expect(row.appId).toBe("finops-instance");
    expect(row.canLaunch).toBe(true);
    expect(row.blockedReasons).toEqual([]);
    expect(row.href).toBe("/apps/finops");
  });

  it("GET /api/agentic-apps blocks launch when installation runtime health is degraded", async () => {
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
        runtimeHealth: "degraded",
      },
    ]);
    store.listAppPackages.mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest: finopsManifestAuthorized },
    ]);
    sessionMock().mockResolvedValue(userSession());

    const { GET } = await import("@/app/api/agentic-apps/route");
    const res = await GET(new Request("http://localhost/api/agentic-apps"));
    expect(res.status).toBe(200);
    const row = (await res.json()).items[0];
    expect(row.canLaunch).toBe(false);
    expect(row.blockedReasons).toContain("unhealthy");
    expect(row.href).toBe("/apps/finops");
  });

  it("GET /api/agentic-apps/packages returns Gallery packages with install status and blockedReasons", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
    };
    store.listAppPackages.mockResolvedValue([
      {
        packageId: "finops",
        source: "builtin",
        manifest: finopsManifestAuthorized,
        catalog: { categories: ["cost"] },
      },
      {
        packageId: "other",
        source: "builtin",
        manifest: {
          ...finopsManifestAuthorized,
          id: "other",
          displayName: "Other",
        },
      },
    ]);
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "finops-instance",
        packageId: "finops",
        installed: true,
        enabled: true,
      },
    ]);

    sessionMock().mockResolvedValue(userSession());

    const { GET } = await import("@/app/api/agentic-apps/packages/route");
    const res = await GET(new Request("http://localhost/api/agentic-apps/packages"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    const finopsRow = body.items.find((x: { packageId: string }) => x.packageId === "finops");
    expect(finopsRow.installStatus).toBe("installed");
    expect(finopsRow.canLaunch).toBe(true);
    expect(finopsRow.blockedReasons).toEqual([]);
    expect(finopsRow.href).toBe("/apps/finops");
    const other = body.items.find((x: { packageId: string }) => x.packageId === "other");
    expect(other.installStatus).toBe("not_installed");
    expect(other.canLaunch).toBe(false);
    expect(other.blockedReasons).toContain("not_installed");
    expect(other.href).toBe("/apps/finops");
  });

  it("GET /api/agentic-apps/packages marks installed package unhealthy when runtimeHealth is unreachable", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
    };
    store.listAppPackages.mockResolvedValue([
      {
        packageId: "finops",
        source: "builtin",
        manifest: finopsManifestAuthorized,
        catalog: { categories: ["cost"] },
      },
    ]);
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "finops-instance",
        packageId: "finops",
        installed: true,
        enabled: true,
        runtimeHealth: "unreachable",
      },
    ]);
    sessionMock().mockResolvedValue(userSession());

    const { GET } = await import("@/app/api/agentic-apps/packages/route");
    const res = await GET(new Request("http://localhost/api/agentic-apps/packages"));
    expect(res.status).toBe(200);
    const row = (await res.json()).items[0];
    expect(row.canLaunch).toBe(false);
    expect(row.blockedReasons).toContain("unhealthy");
    expect(row.href).toBe("/apps/finops");
  });

  it("GET /api/agentic-apps/packages filters by q, category, and status", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
    };
    store.listAppPackages.mockResolvedValue([
      {
        packageId: "alpha-app",
        source: "builtin",
        manifest: {
          ...finopsManifestAuthorized,
          id: "alpha-app",
          displayName: "Alpha Analytics",
          description: "Analytics suite",
        },
        catalog: { categories: ["analytics"] },
      },
      {
        packageId: "beta-cost",
        source: "builtin",
        manifest: {
          ...finopsManifestAuthorized,
          id: "beta-cost",
          displayName: "Beta Cost",
          description: "Spend",
        },
        catalog: { categories: ["cost"] },
      },
    ]);
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "b1",
        packageId: "beta-cost",
        installed: true,
        enabled: true,
      },
    ]);
    sessionMock().mockResolvedValue(userSession());

    const { GET } = await import("@/app/api/agentic-apps/packages/route");

    const qRes = await GET(
      new Request("http://localhost/api/agentic-apps/packages?q=Alpha"),
    );
    expect((await qRes.json()).items.map((i: { packageId: string }) => i.packageId)).toEqual([
      "alpha-app",
    ]);

    const catRes = await GET(
      new Request("http://localhost/api/agentic-apps/packages?category=cost"),
    );
    expect((await catRes.json()).items.map((i: { packageId: string }) => i.packageId)).toEqual([
      "beta-cost",
    ]);

    const stRes = await GET(
      new Request("http://localhost/api/agentic-apps/packages?status=installed"),
    );
    expect((await stRes.json()).items.map((i: { packageId: string }) => i.packageId)).toEqual([
      "beta-cost",
    ]);
  });

  it("GET /api/agentic-apps/packages returns 400 for invalid status filter", async () => {
    sessionMock().mockResolvedValue(userSession());

    const { GET } = await import("@/app/api/agentic-apps/packages/route");
    const res = await GET(
      new Request("http://localhost/api/agentic-apps/packages?status=invalid-status"),
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/agentic-apps/[appId] includes requestedTokenScopes and agents when canLaunch is true", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
    };
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "ok-app",
        packageId: "finops",
        installed: true,
        enabled: true,
        runtimeHealth: "healthy",
      },
    ]);
    store.listAppPackages.mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest: finopsManifestAuthorized },
    ]);
    sessionMock().mockResolvedValue(userSession());

    const { GET } = await import("@/app/api/agentic-apps/[appId]/route");
    const res = await GET(
      new Request("http://localhost/api/agentic-apps/ok-app"),
      { params: Promise.resolve({ appId: "ok-app" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canLaunch).toBe(true);
    expect(body.package.requestedTokenScopes).toEqual(["finops:read"]);
    expect(body.package.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "a1", displayName: "Analyst", required: true }),
      ]),
    );
    expect(body.package.runtime).not.toHaveProperty("origin");
    expect(body.package).not.toHaveProperty("health");
  });

  it("GET /api/agentic-apps/[appId] returns detail and blocked reason when unauthorized", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
    };
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "locked-app",
        packageId: "finops",
        installed: true,
        enabled: true,
        runtimeHealth: "healthy",
      },
    ]);
    store.listAppPackages.mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest: finopsManifestAdminOnly },
    ]);

    sessionMock().mockResolvedValue(userSession());

    const { GET } = await import("@/app/api/agentic-apps/[appId]/route");
    const res = await GET(
      new Request("http://localhost/api/agentic-apps/locked-app"),
      { params: Promise.resolve({ appId: "locked-app" }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canLaunch).toBe(false);
    expect(body.blockedReason).toBe("unauthorized");
    expect(body.blockedReasons).toContain("unauthorized");
    expect(body.runtimeStatus).toBe("healthy");
    expect(body.href).toBe("/apps/finops");
    expect(body.package).not.toHaveProperty("requestedTokenScopes");
    expect(body.package).not.toHaveProperty("agents");
    expect(body.package.runtime).not.toHaveProperty("origin");
    expect(body.package).not.toHaveProperty("health");
  });

  it("GET /api/agentic-apps/[appId] reflects unreachable health and blocks launch with unhealthy reason", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
    };
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "h1",
        packageId: "finops",
        installed: true,
        enabled: true,
        runtimeHealth: "unreachable",
      },
    ]);
    store.listAppPackages.mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest: finopsManifestAuthorized },
    ]);
    sessionMock().mockResolvedValue(userSession());

    const { GET } = await import("@/app/api/agentic-apps/[appId]/route");
    const res = await GET(
      new Request("http://localhost/api/agentic-apps/h1"),
      { params: Promise.resolve({ appId: "h1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("unreachable");
    expect(body.canLaunch).toBe(false);
    expect(body.blockedReason).toBe("unhealthy");
    expect(body.blockedReasons).toContain("unhealthy");
    expect(body.href).toBe("/apps/finops");
    expect(body.package).not.toHaveProperty("requestedTokenScopes");
    expect(body.package).not.toHaveProperty("agents");
    expect(body.package.runtime).not.toHaveProperty("origin");
    expect(body.package).not.toHaveProperty("health");
  });

  it("GET /api/agentic-apps/[appId] uses degraded installation health in runtimeStatus and blocked reasons", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
    };
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "h2",
        packageId: "finops",
        installed: true,
        enabled: true,
        runtimeHealth: "degraded",
      },
    ]);
    store.listAppPackages.mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest: finopsManifestAuthorized },
    ]);
    sessionMock().mockResolvedValue(userSession());

    const { GET } = await import("@/app/api/agentic-apps/[appId]/route");
    const res = await GET(
      new Request("http://localhost/api/agentic-apps/h2"),
      { params: Promise.resolve({ appId: "h2" }) },
    );
    const body = await res.json();
    expect(body.runtimeStatus).toBe("degraded");
    expect(body.canLaunch).toBe(false);
    expect(body.blockedReason).toBe("unhealthy");
    expect(body.href).toBe("/apps/finops");
    expect(body.package).not.toHaveProperty("requestedTokenScopes");
    expect(body.package).not.toHaveProperty("agents");
  });

  it("uses installation runtimeMountPath for hub href when set", async () => {
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
        runtimeHealth: "healthy",
        runtimeMountPath: "/apps/custom-finops",
      },
    ]);
    store.listAppPackages.mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest: finopsManifestAuthorized },
    ]);
    sessionMock().mockResolvedValue(userSession());

    const { GET } = await import("@/app/api/agentic-apps/route");
    const res = await GET(new Request("http://localhost/api/agentic-apps"));
    const row = (await res.json()).items[0];
    expect(row.href).toBe("/apps/custom-finops");
  });

  it("returns 404 when AGENTIC_APPS_INSTALL_ENABLED is unset", async () => {
    delete process.env.AGENTIC_APPS_INSTALL_ENABLED;
    sessionMock().mockResolvedValue(userSession());

    const { GET } = await import("@/app/api/agentic-apps/route");
    const res = await GET(new Request("http://localhost/api/agentic-apps"));

    expect(res.status).toBe(404);
    expect(sessionMock()).not.toHaveBeenCalled();
  });

  it("NEXT_PUBLIC_AGENTIC_APPS_INSTALL_ENABLED does not enable /api/agentic-apps, /packages, or /[appId]", async () => {
    delete process.env.AGENTIC_APPS_INSTALL_ENABLED;
    process.env.NEXT_PUBLIC_AGENTIC_APPS_INSTALL_ENABLED = "true";
    sessionMock().mockResolvedValue(userSession());

    const { GET: getHub } = await import("@/app/api/agentic-apps/route");
    expect((await getHub(new Request("http://localhost/api/agentic-apps"))).status).toBe(404);

    const { GET: getPackages } = await import("@/app/api/agentic-apps/packages/route");
    expect(
      (await getPackages(new Request("http://localhost/api/agentic-apps/packages"))).status,
    ).toBe(404);

    const { GET: getDetail } = await import("@/app/api/agentic-apps/[appId]/route");
    expect(
      (
        await getDetail(new Request("http://localhost/api/agentic-apps/x"), {
          params: Promise.resolve({ appId: "x" }),
        })
      ).status,
    ).toBe(404);
  });

  it("returns 503 when MongoDB is not configured for packages and detail routes; /api/agentic-apps falls back to env-based registry", async () => {
    mongoGate.configured = false;
    sessionMock().mockResolvedValue(userSession());

    // /api/agentic-apps still answers (with env-based items only) so that
    // env-only deployments — and home-page Pinned Apps — keep working.
    const { GET: getHub } = await import("@/app/api/agentic-apps/route");
    expect((await getHub(new Request("http://localhost/api/agentic-apps"))).status).toBe(200);

    const { GET: getPackages } = await import("@/app/api/agentic-apps/packages/route");
    expect(
      (await getPackages(new Request("http://localhost/api/agentic-apps/packages"))).status,
    ).toBe(503);

    const { GET: getDetail } = await import("@/app/api/agentic-apps/[appId]/route");
    expect(
      (
        await getDetail(new Request("http://localhost/api/agentic-apps/x"), {
          params: Promise.resolve({ appId: "x" }),
        })
      ).status,
    ).toBe(503);
  });

  it("returns 401 when unauthenticated (SSO on)", async () => {
    sessionMock().mockResolvedValue(null);

    const { GET } = await import("@/app/api/agentic-apps/route");
    const res = await GET(new Request("http://localhost/api/agentic-apps"));

    expect(res.status).toBe(401);
  });
});
