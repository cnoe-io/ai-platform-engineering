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
    appendPdpDecision: jest.fn(),
    appendAppTokenGrant: jest.fn(),
  };
});

function sessionMock(): jest.Mock {
  return (require("next-auth") as { getServerSession: jest.Mock }).getServerSession;
}

function storeMocks() {
  return jest.requireMock("@/lib/agentic-apps/store") as {
    listAppPackages: jest.Mock;
    listAppInstallations: jest.Mock;
    appendPdpDecision: jest.Mock;
    appendAppTokenGrant: jest.Mock;
  };
}

const finopsManifest: AgenticAppManifest = {
  id: "finops-pkg",
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
};

const iframeManifest: AgenticAppManifest = {
  ...finopsManifest,
  id: "iframe-pkg",
  runtime: {
    ...finopsManifest.runtime,
    kind: "iframe-sandboxed",
  },
};

describe("GET /apps/{appId}/{path} execution gateway", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";
    process.env.NEXTAUTH_SECRET = "test-agentic-app-token-secret";
    delete process.env.AGENTIC_APPS_ENABLED;
    delete process.env.AGENTIC_APP_FINOPS_ORIGIN;
    delete process.env.AGENTIC_APP_WEATHER_ORIGIN;
    mongoGate.configured = true;

    const store = storeMocks();
    store.listAppPackages.mockReset().mockResolvedValue([
      { packageId: "finops-pkg", source: "builtin" as const, manifest: finopsManifest },
    ]);
    store.listAppInstallations.mockReset().mockResolvedValue([
      {
        appId: "finops",
        packageId: "finops-pkg",
        installed: true,
        enabled: true,
        runtimeHealth: "healthy",
      },
    ]);
    store.appendPdpDecision.mockReset().mockResolvedValue(undefined);
    store.appendAppTokenGrant.mockReset().mockResolvedValue(undefined);

    sessionMock().mockReset();
    sessionMock().mockResolvedValue({
      user: { email: "user@example.com", name: "User" },
      role: "user",
      canViewAdmin: false,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("proxies authorized installed app requests to the effective runtime origin", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response("<html>finops</html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "set-cookie": "app_session=leak",
          "x-frame-options": "SAMEORIGIN",
        },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(
      new Request("http://localhost/apps/finops/dashboard?range=30d"),
      { params: Promise.resolve({ appId: "finops", path: ["dashboard"] }) },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3010/dashboard?range=30d",
      expect.objectContaining({ method: "GET" }),
    );
    const proxiedHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(proxiedHeaders.get("x-caipe-app-id")).toBe("finops");
    expect(proxiedHeaders.get("x-caipe-decision-id")).toBeTruthy();
    expect(proxiedHeaders.get("x-correlation-id")).toBeTruthy();
    expect(proxiedHeaders.get("authorization") ?? "").toMatch(/^Bearer /);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-caipe-decision-id")).toBeTruthy();
    expect(res.headers.get("x-correlation-id")).toBeTruthy();
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.has("set-cookie")).toBe(false);
    expect(res.headers.has("x-frame-options")).toBe(false);
    expect(await res.text()).toBe("<html>finops</html>");
  });

  it("allows admin sessions to launch apps gated to user role", async () => {
    sessionMock().mockResolvedValue({
      user: { email: "admin@example.com", name: "Admin" },
      role: "admin",
      canViewAdmin: true,
    });
    const fetchMock = jest.fn().mockResolvedValue(
      new Response("<html>finops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("uses installation runtimeOriginOverride over manifest origin when set", async () => {
    const store = storeMocks();
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "finops",
        packageId: "finops-pkg",
        installed: true,
        enabled: true,
        runtimeHealth: "healthy",
        runtimeOriginOverride: "http://upstream.example:9000",
      },
    ]);
    const fetchMock = jest.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    await GET(new Request("http://localhost/apps/finops/a/b"), {
      params: Promise.resolve({ appId: "finops", path: ["a", "b"] }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://upstream.example:9000/a/b",
      expect.anything(),
    );
  });

  it("proxies env-enabled built-in apps when Mongo has no installation record", async () => {
    const store = storeMocks();
    store.listAppPackages.mockResolvedValue([]);
    store.listAppInstallations.mockResolvedValue([]);
    process.env.AGENTIC_APPS_ENABLED = "finops";
    process.env.AGENTIC_APP_FINOPS_ORIGIN = "http://localhost:3010";

    const fetchMock = jest.fn().mockResolvedValue(
      new Response("<html>finops env</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3010/",
      expect.objectContaining({ method: "GET" }),
    );
    const proxiedHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(proxiedHeaders.get("x-caipe-app-id")).toBe("finops");
    expect(proxiedHeaders.get("authorization") ?? "").toMatch(/^Bearer /);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>finops env</html>");
  });

  it("redirects direct browser document navigation for iframe-chrome apps to the embed shell", async () => {
    const store = storeMocks();
    store.listAppPackages.mockResolvedValue([]);
    store.listAppInstallations.mockResolvedValue([]);
    process.env.AGENTIC_APPS_ENABLED = "finops";
    process.env.AGENTIC_APP_FINOPS_ORIGIN = "http://localhost:3010";

    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(
      new Request("http://localhost/apps/finops", {
        headers: { "sec-fetch-dest": "document" },
      }),
      { params: Promise.resolve({ appId: "finops", path: [] }) },
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/apps/embed/finops");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps iframe requests for iframe-chrome apps on the internal proxy path", async () => {
    const store = storeMocks();
    store.listAppPackages.mockResolvedValue([]);
    store.listAppInstallations.mockResolvedValue([]);
    process.env.AGENTIC_APPS_ENABLED = "finops";
    process.env.AGENTIC_APP_FINOPS_ORIGIN = "http://localhost:3010";

    const fetchMock = jest.fn().mockResolvedValue(new Response("<html>finops iframe</html>", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(
      new Request("http://localhost/apps/finops", {
        headers: { "sec-fetch-dest": "iframe" },
      }),
      { params: Promise.resolve({ appId: "finops", path: [] }) },
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3010/", expect.anything());
    expect(await res.text()).toBe("<html>finops iframe</html>");
  });

  it("returns 404 and does not call upstream when server install gate is off", async () => {
    delete process.env.AGENTIC_APPS_INSTALL_ENABLED;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not honor NEXT_PUBLIC_AGENTIC_APPS_INSTALL_ENABLED for the execution gate", async () => {
    process.env.NEXT_PUBLIC_AGENTIC_APPS_INSTALL_ENABLED = "true";
    delete process.env.AGENTIC_APPS_INSTALL_ENABLED;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when MongoDB is not configured (after authentication)", async () => {
    mongoGate.configured = false;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "mongodb_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no session even if MongoDB is not configured", async () => {
    mongoGate.configured = false;
    sessionMock().mockResolvedValue(null);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 gateway_store_unavailable when store load throws", async () => {
    const store = storeMocks();
    store.listAppInstallations.mockRejectedValue(new Error("mongo down"));
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "gateway_store_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 and does not call upstream when access override denies the user", async () => {
    const store = storeMocks();
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "finops",
        packageId: "finops-pkg",
        installed: true,
        enabled: true,
        runtimeHealth: "healthy",
        accessOverrides: { requiredRoles: ["admin"] },
      },
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops/private"), {
      params: Promise.resolve({ appId: "finops", path: ["private"] }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "app_unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 upstream_unavailable when upstream fetch rejects", async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError("network error"));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops/x"), {
      params: Promise.resolve({ appId: "finops", path: ["x"] }),
    });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream_unavailable" });
  });

  it("does not forward Cookie, Host, Proxy-Authorization, or client-provided Authorization to upstream", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    await GET(
      new Request("http://localhost/apps/finops/", {
        headers: {
          cookie: "sid=secret",
          host: "evil.example",
          "proxy-authorization": "Basic xxx",
          authorization: "Bearer attacker-supplied",
          "accept-language": "en",
        },
      }),
      { params: Promise.resolve({ appId: "finops", path: [] }) },
    );

    const proxiedHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(proxiedHeaders.has("cookie")).toBe(false);
    expect(proxiedHeaders.has("host")).toBe(false);
    expect(proxiedHeaders.has("proxy-authorization")).toBe(false);
    // Client-supplied Authorization header must never be passed through; only
    // the gateway-minted app-scoped Bearer may travel to the upstream app.
    expect(proxiedHeaders.get("authorization") ?? "").not.toContain("attacker-supplied");
    expect(proxiedHeaders.get("authorization") ?? "").toMatch(/^Bearer /);
    expect(proxiedHeaders.get("accept-language")).toBe("en");
  });

  it("does not forward x-caipe-* headers from the client (defense in depth)", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    await GET(
      new Request("http://localhost/apps/finops/", {
        headers: {
          "x-caipe-app-id": "spoofed",
          "x-caipe-user": "smuggled",
          "x-caipe-roles": "admin,user",
        },
      }),
      { params: Promise.resolve({ appId: "finops", path: [] }) },
    );

    const proxiedHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    // The gateway always sets x-caipe-app-id itself, never trusts the client value.
    expect(proxiedHeaders.get("x-caipe-app-id")).toBe("finops");
    expect(proxiedHeaders.get("x-caipe-user")).not.toBe("smuggled");
  });

  it("POST forwards a buffered body to upstream", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { POST } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await POST(
      new Request("http://localhost/apps/finops/api/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"payload":1}',
      }),
      { params: Promise.resolve({ appId: "finops", path: ["api", "save"] }) },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3010/api/save",
      expect.objectContaining({
        method: "POST",
        body: expect.anything(),
      }),
    );
    const fetchInit = fetchMock.mock.calls[0]?.[1] as RequestInit & { body?: unknown };
    expect(fetchInit.body).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(fetchInit.body as ArrayBuffer).toString("utf8")).toBe('{"payload":1}');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
  });

  it("returns 501 when origin URL contains userinfo", async () => {
    const store = storeMocks();
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "finops",
        packageId: "finops-pkg",
        installed: true,
        enabled: true,
        runtimeHealth: "healthy",
        runtimeOriginOverride: "http://user:pass@localhost:3010",
      },
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: "unsupported_runtime" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no session (no anonymous fallback for execution gateway)", async () => {
    sessionMock().mockResolvedValue(null);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown appId", async () => {
    const store = storeMocks();
    store.listAppInstallations.mockResolvedValue([]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/unknown"), {
      params: Promise.resolve({ appId: "unknown", path: [] }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "app_not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 app_disabled when installation is disabled", async () => {
    const store = storeMocks();
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "finops",
        packageId: "finops-pkg",
        installed: true,
        enabled: false,
        runtimeHealth: "healthy",
      },
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "app_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 app_unauthorized when requiredRoles gates fail", async () => {
    const store = storeMocks();
    store.listAppPackages.mockResolvedValue([
      {
        packageId: "finops-pkg",
        source: "builtin" as const,
        manifest: { ...finopsManifest, access: { requiredRoles: ["admin"], tokenScopes: [] } },
      },
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "app_unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 app_unauthorized when requiredGroups gates fail", async () => {
    const store = storeMocks();
    store.listAppPackages.mockResolvedValue([
      {
        packageId: "finops-pkg",
        source: "builtin" as const,
        manifest: {
          ...finopsManifest,
          access: {
            requiredGroups: ["cost-team"],
            tokenScopes: ["finops:read"],
          },
        },
      },
    ]);
    sessionMock().mockResolvedValue({
      user: { email: "user@example.com", name: "User" },
      role: "user",
      groups: ["other-group"],
      canViewAdmin: false,
    });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "app_unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 app_not_found when installation has installed: false", async () => {
    const store = storeMocks();
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "finops",
        packageId: "finops-pkg",
        installed: false,
        enabled: true,
        runtimeHealth: "healthy",
      },
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "app_not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 app_unhealthy when runtime health is degraded", async () => {
    const store = storeMocks();
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "finops",
        packageId: "finops-pkg",
        installed: true,
        enabled: true,
        runtimeHealth: "degraded",
      },
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "app_unhealthy" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 501 unsupported_runtime for non-proxied runtime kinds", async () => {
    const store = storeMocks();
    store.listAppPackages.mockResolvedValue([
      { packageId: "iframe-pkg", source: "builtin" as const, manifest: iframeManifest },
    ]);
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "ifr",
        packageId: "iframe-pkg",
        installed: true,
        enabled: true,
        runtimeHealth: "healthy",
      },
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/ifr"), {
      params: Promise.resolve({ appId: "ifr", path: [] }),
    });

    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: "unsupported_runtime" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 app_unhealthy when runtime health is unreachable", async () => {
    const store = storeMocks();
    store.listAppInstallations.mockResolvedValue([
      {
        appId: "finops",
        packageId: "finops-pkg",
        installed: true,
        enabled: true,
        runtimeHealth: "unreachable",
      },
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "app_unhealthy" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("app-scoped token forwarding to upstream", () => {
    function getHeaders(call: jest.Mock["mock"]["calls"][number]): Headers {
      return (call?.[1] as { headers: Headers }).headers;
    }

    it("forwards a CAIPE-minted app-scoped token instead of the user's id_token", async () => {
      const fetchMock = jest.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      sessionMock().mockResolvedValue({
        user: { email: "user@example.com", name: "User" },
        sub: "subject-from-oidc",
        role: "user",
        canViewAdmin: false,
        idToken: "header.payload.signature",
      });

      const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
      await GET(new Request("http://localhost/apps/finops/dashboard?range=30d"), {
        params: Promise.resolve({ appId: "finops", path: ["dashboard"] }),
      });

      const headers = getHeaders(fetchMock.mock.calls[0]);
      expect(headers.get("authorization") ?? "").toMatch(/^Bearer ey/);
      expect(headers.get("authorization")).not.toBe("Bearer header.payload.signature");
      expect(headers.get("x-caipe-decision-id")).toBeTruthy();
      expect(headers.get("x-correlation-id")).toBeTruthy();
    });

    it("still sets Authorization when no id_token is on the session", async () => {
      const fetchMock = jest.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      sessionMock().mockResolvedValue({
        user: { email: "user@example.com", name: "User" },
        role: "user",
        canViewAdmin: false,
      });

      const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
      await GET(new Request("http://localhost/apps/finops"), {
        params: Promise.resolve({ appId: "finops", path: [] }),
      });

      const headers = getHeaders(fetchMock.mock.calls[0]);
      expect(headers.get("authorization") ?? "").toMatch(/^Bearer ey/);
    });

    it("attaches non-authoritative identity hints (x-caipe-app-id, x-caipe-user, x-caipe-roles)", async () => {
      const fetchMock = jest.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      sessionMock().mockResolvedValue({
        user: { email: "admin@example.com", name: "Admin" },
        sub: "admin-subject",
        role: "admin",
        canViewAdmin: true,
        idToken: "header.payload.signature",
      });

      const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
      await GET(new Request("http://localhost/apps/finops"), {
        params: Promise.resolve({ appId: "finops", path: [] }),
      });

      const headers = getHeaders(fetchMock.mock.calls[0]);
      expect(headers.get("x-caipe-app-id")).toBe("finops");
      expect(headers.get("x-caipe-user")).toBe("admin-subject");
      // Roles header includes admin and the implied user role.
      expect(headers.get("x-caipe-roles")).toBe("admin,user");
    });

    it("does not emit any HMAC signing headers", async () => {
      const fetchMock = jest.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      sessionMock().mockResolvedValue({
        user: { email: "user@example.com", name: "User" },
        sub: "subject-x",
        role: "user",
        idToken: "tok",
      });

      const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
      await GET(new Request("http://localhost/apps/finops"), {
        params: Promise.resolve({ appId: "finops", path: [] }),
      });

      const headers = getHeaders(fetchMock.mock.calls[0]);
      expect(headers.has("x-caipe-signature")).toBe(false);
      expect(headers.has("x-caipe-timestamp")).toBe(false);
      expect(headers.has("x-caipe-nonce")).toBe(false);
    });
  });

  it("returns 501 unsupported_runtime when proxied runtime has no valid http(s) origin", async () => {
    const store = storeMocks();
    store.listAppPackages.mockResolvedValue([
      {
        packageId: "finops-pkg",
        source: "builtin" as const,
        manifest: { ...finopsManifest, runtime: { ...finopsManifest.runtime, origin: undefined } },
      },
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { GET } = await import("@/app/(app)/apps/[appId]/[[...path]]/route");
    const res = await GET(new Request("http://localhost/apps/finops"), {
      params: Promise.resolve({ appId: "finops", path: [] }),
    });

    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: "unsupported_runtime" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
