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
  upsertAppPackageFromManifest: jest.fn(),
  appendAgenticAppEvent: jest.fn(),
  installAppPackage: jest.fn(),
}));

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
  access: { tokenScopes: ["finops:read"] },
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

function adminSession() {
  return {
    user: { email: "admin@example.com", name: "Admin" },
    role: "admin",
    canViewAdmin: true,
  };
}

function adminViewSession() {
  return {
    user: { email: "viewer@example.com", name: "Viewer" },
    role: "user",
    canViewAdmin: true,
  };
}

describe("admin agentic-apps API", () => {
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
      upsertAppPackageFromManifest: jest.Mock;
      appendAgenticAppEvent: jest.Mock;
      installAppPackage: jest.Mock;
    };
    store.listAppPackages.mockReset().mockResolvedValue([]);
    store.listAppInstallations.mockReset().mockResolvedValue([]);
    store.upsertAppPackageFromManifest.mockReset().mockResolvedValue(undefined);
    store.appendAgenticAppEvent.mockReset().mockResolvedValue(undefined);
    store.installAppPackage.mockReset().mockResolvedValue(undefined);

    sessionMock().mockReset();
    sessionMock().mockResolvedValue(null);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns 404 when AGENTIC_APPS_INSTALL_ENABLED is unset (before auth)", async () => {
    delete process.env.AGENTIC_APPS_INSTALL_ENABLED;
    (sessionMock()).mockResolvedValue(adminSession());

    const { GET } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await GET(new Request("http://localhost/api/admin/agentic-apps/packages"));

    expect(res.status).toBe(404);
    expect(sessionMock()).not.toHaveBeenCalled();
  });

  it("returns 404 when AGENTIC_APPS_INSTALL_ENABLED is not literally true", async () => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "1";
    (sessionMock()).mockResolvedValue(adminSession());

    const { GET } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await GET(new Request("http://localhost/api/admin/agentic-apps/packages"));

    expect(res.status).toBe(404);
  });

  it("does not enable routes via NEXT_PUBLIC_AGENTIC_APPS_INSTALL_ENABLED alone", async () => {
    delete process.env.AGENTIC_APPS_INSTALL_ENABLED;
    process.env.NEXT_PUBLIC_AGENTIC_APPS_INSTALL_ENABLED = "true";
    (sessionMock()).mockResolvedValue(adminSession());

    const { GET } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await GET(new Request("http://localhost/api/admin/agentic-apps/packages"));

    expect(res.status).toBe(404);
  });

  it("returns 503 when MongoDB is not configured", async () => {
    mongoGate.configured = false;
    (sessionMock()).mockResolvedValue(adminSession());

    const { GET } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await GET(new Request("http://localhost/api/admin/agentic-apps/packages"));

    expect(res.status).toBe(503);
    expect(sessionMock()).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    (sessionMock()).mockResolvedValue(null);

    const { GET } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await GET(new Request("http://localhost/api/admin/agentic-apps/packages"));

    expect(res.status).toBe(401);
  });

  it("GET /api/admin/agentic-apps/packages allows admin-view session", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as { listAppPackages: jest.Mock };
    store.listAppPackages.mockResolvedValue([{ packageId: "finops", source: "builtin", manifest: finopsManifest }]);

    (sessionMock()).mockResolvedValue(adminViewSession());

    const { GET } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await GET(new Request("http://localhost/api/admin/agentic-apps/packages"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].packageId).toBe("finops");
  });

  it("POST /api/admin/agentic-apps/packages returns 403 for admin-view only (no full admin)", async () => {
    (sessionMock()).mockResolvedValue(adminViewSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: finopsManifest }),
      }),
    );

    expect(res.status).toBe(403);
  });

  it("POST /api/admin/agentic-apps/packages rejects catalog unknown keys", async () => {
    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifest: finopsManifest,
          catalog: { categories: ["x"], rogueKey: true },
        }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("POST /api/admin/agentic-apps/packages rejects catalog with non-string array entries", async () => {
    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifest: finopsManifest,
          catalog: { capabilities: [1, 2] },
        }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("POST /api/admin/agentic-apps/packages passes sanitized catalog to the store", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      upsertAppPackageFromManifest: jest.Mock;
    };

    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifest: finopsManifest,
          catalog: { categories: ["cost"], capabilities: ["analytics"] },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(store.upsertAppPackageFromManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        catalog: { categories: ["cost"], capabilities: ["analytics"] },
      }),
    );
  });

  it("POST /api/admin/agentic-apps/packages rejects a new package that conflicts with an existing route", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      upsertAppPackageFromManifest: jest.Mock;
      listAppPackages: jest.Mock;
      appendAgenticAppEvent: jest.Mock;
    };
    store.listAppPackages.mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest: finopsManifest },
    ]);

    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifest: {
            ...finopsManifest,
            id: "weather",
            displayName: "Weather",
            runtime: { ...finopsManifest.runtime, mountPath: "/apps/finops" },
          },
        }),
      }),
    );

    expect(res.status).toBe(409);
    expect(store.upsertAppPackageFromManifest).not.toHaveBeenCalled();
    expect(store.appendAgenticAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentic_app_package_rejected",
        packageId: "weather",
      }),
    );
  });

  it("POST /api/admin/agentic-apps/packages allows re-importing the same package route", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      upsertAppPackageFromManifest: jest.Mock;
      listAppPackages: jest.Mock;
    };
    store.listAppPackages.mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest: finopsManifest },
    ]);

    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: finopsManifest }),
      }),
    );

    expect(res.status).toBe(200);
    expect(store.upsertAppPackageFromManifest).toHaveBeenCalled();
  });

  it("POST /api/admin/agentic-apps/packages audit payload includes only source and warnings", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      upsertAppPackageFromManifest: jest.Mock;
      appendAgenticAppEvent: jest.Mock;
    };

    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifest: finopsManifest,
          source: "admin-import",
          catalog: { categories: ["visible-in-upsert-only"] },
        }),
      }),
    );

    expect(res.status).toBe(200);

    const eventArg = store.appendAgenticAppEvent.mock.calls[0][0];
    const pl = eventArg.payload as Record<string, unknown>;
    expect(Object.keys(pl).sort()).toEqual(["source", "warnings"]);
    expect(pl.source).toBe("admin-import");
    expect(Array.isArray(pl.warnings)).toBe(true);
    expect(pl).not.toHaveProperty("manifest");
    expect(pl).not.toHaveProperty("catalog");
    expect(JSON.stringify(pl)).not.toContain("visible-in-upsert-only");

    expect(store.upsertAppPackageFromManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        catalog: { categories: ["visible-in-upsert-only"] },
      }),
    );
  });

  it("POST /api/admin/agentic-apps/packages rejects invalid manifest with 400", async () => {
    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: { not: "valid" } }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("POST /api/admin/agentic-apps/packages imports valid manifest via store", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      upsertAppPackageFromManifest: jest.Mock;
      appendAgenticAppEvent: jest.Mock;
    };

    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/packages/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: finopsManifest, source: "admin-import" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(store.upsertAppPackageFromManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        packageId: "finops",
        source: "admin-import",
        manifest: finopsManifest,
        importedBy: "admin@example.com",
      }),
    );
    expect(store.appendAgenticAppEvent).toHaveBeenCalled();
  });

  it("GET /api/admin/agentic-apps/installations allows admin-view and returns store data", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      listAppInstallations: jest.Mock;
      listAppPackages: jest.Mock;
    };
    store.listAppInstallations.mockResolvedValue([{ appId: "finops", packageId: "finops", installed: true, enabled: true }]);
    store.listAppPackages.mockResolvedValue([{ packageId: "finops", source: "builtin", manifest: finopsManifest }]);

    (sessionMock()).mockResolvedValue(adminViewSession());

    const { GET } = await import("@/app/api/admin/agentic-apps/installations/route");
    const res = await GET(new Request("http://localhost/api/admin/agentic-apps/installations"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.installations).toHaveLength(1);
    expect(body.packages).toHaveLength(1);
  });

  it("POST /api/admin/agentic-apps/installations requires full admin", async () => {
    (sessionMock()).mockResolvedValue(adminViewSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/installations/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/installations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId: "finops", packageId: "finops" }),
      }),
    );

    expect(res.status).toBe(403);
  });

  it("POST /api/admin/agentic-apps/installations rejects non-string appId", async () => {
    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/installations/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/installations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId: 42, packageId: "finops" }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("POST /api/admin/agentic-apps/installations rejects object packageId", async () => {
    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/installations/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/installations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId: "finops", packageId: { not: "a string" } }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("POST /api/admin/agentic-apps/installations calls installAppPackage for admin", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      installAppPackage: jest.Mock;
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
    };
    store.listAppPackages.mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest: finopsManifest },
    ]);
    store.listAppInstallations.mockResolvedValue([]);

    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/installations/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/installations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appId: "finops",
          packageId: "finops",
          enabled: true,
          installed: true,
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(store.installAppPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "finops",
        packageId: "finops",
        enabled: true,
        installed: true,
      }),
    );
  });

  it("POST /api/admin/agentic-apps/installations rejects route conflicts before installing", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      installAppPackage: jest.Mock;
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
      appendAgenticAppEvent: jest.Mock;
    };
    store.listAppPackages.mockResolvedValue([
      {
        packageId: "finops",
        source: "builtin",
        manifest: finopsManifest,
      },
      {
        packageId: "weather",
        source: "builtin",
        manifest: {
          ...finopsManifest,
          id: "weather",
          runtime: { ...finopsManifest.runtime, mountPath: "/apps/finops" },
        },
      },
    ]);
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "finops",
        packageId: "finops",
        installed: true,
        enabled: true,
        routeOwnership: { normalizedMountPath: "/apps/finops" },
      },
    ]);

    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/installations/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/installations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId: "weather", packageId: "weather" }),
      }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("route conflict"),
      }),
    );
    expect(store.installAppPackage).not.toHaveBeenCalled();
    expect(store.appendAgenticAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentic_app_install_rejected",
        appId: "weather",
        packageId: "weather",
      }),
    );
  });

  it("POST /api/admin/agentic-apps/installations persists runtime, visibility, access, health, route, and audit metadata", async () => {
    const store = jest.requireMock("@/lib/agentic-apps/store") as {
      installAppPackage: jest.Mock;
      listAppPackages: jest.Mock;
      listAppInstallations: jest.Mock;
      appendAgenticAppEvent: jest.Mock;
    };
    store.listAppPackages.mockResolvedValue([
      { packageId: "finops", source: "builtin", manifest: finopsManifest },
    ]);
    store.listAppInstallations.mockResolvedValue([]);

    (sessionMock()).mockResolvedValue(adminSession());

    const { POST } = await import("@/app/api/admin/agentic-apps/installations/route");
    const res = await POST(
      new Request("http://localhost/api/admin/agentic-apps/installations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appId: "finops",
          packageId: "finops",
          installed: true,
          enabled: true,
          visible: false,
          runtimeOriginOverride: "http://localhost:3333",
          runtimeMountPath: "/apps/custom-finops",
          accessOverrides: { requiredRoles: ["admin"] },
          healthPolicy: { blockLaunchWhen: ["unknown", "degraded", "unreachable"] },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(store.installAppPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "finops",
        packageId: "finops",
        visible: false,
        runtimeOriginOverride: "http://localhost:3333",
        runtimeMountPath: "/apps/custom-finops",
        accessOverrides: { requiredRoles: ["admin"] },
        healthPolicy: { blockLaunchWhen: ["unknown", "degraded", "unreachable"] },
        routeOwnership: { normalizedMountPath: "/apps/custom-finops" },
        updatedBy: "admin@example.com",
      }),
    );
    expect(store.appendAgenticAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentic_app_installation_updated",
        actorEmail: "admin@example.com",
        appId: "finops",
        packageId: "finops",
      }),
    );
  });
});
