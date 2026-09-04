/** @jest-environment node */

import { NextRequest } from "next/server";

const mockRequireResourcePermission = jest.fn();
const mockListAppInstallations = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: jest.fn().mockResolvedValue({
    user: { email: "test-user@example.com", name: "Test User", role: "admin" },
    session: { sub: "stable-subject", role: "admin" },
  }),
  successResponse: (data: unknown) => Response.json(data),
  withErrorHandler: (handler: unknown) => handler,
}));

jest.mock("@/lib/api-error", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public code?: string,
    ) {
      super(message);
    }
  },
}));

jest.mock("@/lib/agentic-apps/config", () => ({
  isAgenticAppsEnabled: () => true,
  getConfiguredAgenticApp: () => ({
    manifest: { id: "example-app" },
    installation: {
      appId: "example-app",
      packageId: "example-app",
      installed: true,
      enabled: true,
      visible: true,
    },
  }),
}));

jest.mock("@/lib/agentic-apps/store", () => ({
  appendAgenticAppEvent: jest.fn(),
  installAppPackage: jest.fn(),
  listAppInstallations: () => mockListAppInstallations(),
  updateAppInstallationSharing: jest.fn(),
}));

jest.mock("@/lib/agentic-apps/cas-compat", () => ({
  resolveAgenticAppCasMode: () => "enforce",
}));

jest.mock("@/lib/mongodb", () => ({ isMongoDBConfigured: true }));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) =>
    mockRequireResourcePermission(...args),
  subjectFromSession: () => "user:stable-subject",
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: jest.fn().mockResolvedValue({ allowed: false }),
}));

import { GET } from "./route";

describe("External App sharing API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListAppInstallations.mockResolvedValue([]);
    mockRequireResourcePermission.mockResolvedValue(undefined);
  });

  it("synthesizes sharing state from the configured catalog before persistence", async () => {
    const response = await GET(
      new NextRequest("https://host.example/api/agentic-apps/example-app/sharing"),
      { params: Promise.resolve({ appId: "example-app" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        appId: "example-app",
        visibility: "global",
        createdBy: "seed-config",
        canManage: true,
      }),
    );
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "agentic_app", id: "example-app" }),
    );
  });
});
