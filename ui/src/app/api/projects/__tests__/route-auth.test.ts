/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetCollection = jest.fn();
const mockGetAuthFromBearerOrSession = jest.fn(async () => ({
  user: { email: "viewer@example.test" },
  session: {
    sub: "viewer-subject",
    user: { email: "viewer@example.test" },
  },
}));
const mockIsTomeAdmin = jest.fn(async () => false);

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: (...args: unknown[]) =>
      mockGetAuthFromBearerOrSession(...args),
  };
});

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/rbac/tome-admin", () => ({
  isTomeAdmin: (...args: unknown[]) => mockIsTomeAdmin(...args),
}));

import { GET, POST } from "../route";

function createRequest(type: "bhag" | "area"): NextRequest {
  return new NextRequest("http://example.test/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Example ${type}`,
      type,
      team_id: "example-team",
    }),
  });
}

describe("POST /api/projects Tome entity authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsTomeAdmin.mockResolvedValue(false);
  });

  it.each(["bhag", "area"] as const)(
    "denies non-admin creation of a %s before any database write",
    async (type) => {
      const response = await POST(createRequest(type));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({
        success: false,
        code: "TOME_ADMIN_REQUIRED",
      });
      expect(mockGetCollection).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/projects scoped-principal boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(["catalog_api_key", "skills_api_key"])(
    "rejects %s before catalog discovery",
    async (principalType) => {
      mockGetAuthFromBearerOrSession.mockResolvedValue({
        user: { email: "catalog-user@example.test" },
        session: { sub: "catalog-user", principalType },
      });

      const response = await GET(
        new NextRequest("http://example.test/api/projects"),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: "TOME_INTERACTIVE_PRINCIPAL_REQUIRED",
      });
      expect(mockIsTomeAdmin).not.toHaveBeenCalled();
      expect(mockGetCollection).not.toHaveBeenCalled();
    },
  );
});
