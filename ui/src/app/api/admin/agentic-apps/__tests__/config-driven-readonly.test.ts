/**
 * @jest-environment node
 */

const mockStore = {
  appendAgenticAppEvent: jest.fn(),
  installAppPackage: jest.fn(),
  listAppInstallations: jest.fn(),
  listAppPackages: jest.fn(),
  upsertAppPackageFromManifest: jest.fn(),
};

jest.mock("@/lib/agentic-apps/guard", () => ({
  requireAgenticAppsInstallEnabled: jest.fn(),
}));

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/agentic-apps/store", () => mockStore);

jest.mock("@/lib/api-middleware", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public code?: string,
    ) {
      super(message);
    }
  },
  requireRbacPermission: jest.fn(),
  successResponse: (value: unknown) => Response.json(value),
  validateRequired: jest.fn(),
  withAuth: jest.fn(async (request, handler) =>
    handler(
      request,
      { email: "admin@example.com" },
      { role: "admin" },
    ),
  ),
  withErrorHandler: (handler: unknown) => handler,
}));

const manifest = {
  id: "example-app",
  displayName: "Example App",
  description: "Example config-driven app.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    mountPath: "/apps/example-app",
    origin: "http://example-app.example.svc:80",
  },
  surfaces: { showInHub: true },
  access: { tokenScopes: ["example-app:read"] },
  health: { endpoint: "/healthz" },
};

describe("config-driven Agentic Apps admin protection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.listAppPackages.mockResolvedValue([]);
    mockStore.listAppInstallations.mockResolvedValue([]);
  });

  it("rejects an admin package overwrite", async () => {
    mockStore.listAppPackages.mockResolvedValue([
      {
        packageId: "example-app",
        source: "helm",
        manifest,
        config_driven: true,
      },
    ]);
    const { POST } = await import("../packages/route");

    await expect(
      POST(
        new Request("http://localhost/api/admin/agentic-apps/packages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ manifest }),
        }) as never,
      ),
    ).rejects.toMatchObject({ statusCode: 409,code: "config_driven" });
    expect(mockStore.upsertAppPackageFromManifest).not.toHaveBeenCalled();
  });

  it("rejects an admin installation overwrite", async () => {
    mockStore.listAppPackages.mockResolvedValue([
      { packageId: "example-app",source: "helm",manifest },
    ]);
    mockStore.listAppInstallations.mockResolvedValue([
      {
        appId: "example-app",
        packageId: "example-app",
        installed: true,
        enabled: true,
        config_driven: true,
      },
    ]);
    const { POST } = await import("../installations/route");

    await expect(
      POST(
        new Request("http://localhost/api/admin/agentic-apps/installations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ appId: "example-app",packageId: "example-app" }),
        }) as never,
      ),
    ).rejects.toMatchObject({ statusCode: 409,code: "config_driven" });
    expect(mockStore.installAppPackage).not.toHaveBeenCalled();
  });
});
