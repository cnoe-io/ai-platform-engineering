/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockGetCollection = jest.fn();
const mockGetRbacCollection = jest.fn();
const mockRequireResourcePermission = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
  successResponse: (data: unknown) => Response.json({ success: true, data }),
  withErrorHandler:
    <T,>(handler: (request: NextRequest) => Promise<T>) =>
    async (request: NextRequest) => handler(request),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/mongo-collections", () => ({
  getRbacCollection: (...args: unknown[]) => mockGetRbacCollection(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

const session = { sub: "alice-sub" };
const user = { email: "alice@example.com" };

describe("GET /api/dynamic-agents/teams", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user, session });
    mockRequireResourcePermission.mockRejectedValue(new Error("not org admin"));
  });

  it("marks can_own_agents for team members, not just admins", async () => {
    mockGetRbacCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { team_slug: "platform", relationship: "member", status: "active", user_email: "alice@example.com" },
          { team_slug: "sre", relationship: "admin", status: "active", user_email: "alice@example.com" },
        ]),
      }),
    });
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([
          { _id: "team-1", name: "Platform", slug: "platform" },
          { _id: "team-2", name: "SRE", slug: "sre" },
        ]),
      }),
    });

    const { GET } = await import("../route");
    const response = await GET(new NextRequest("http://localhost/api/dynamic-agents/teams"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "platform", user_role: "member", can_own_agents: true }),
        expect.objectContaining({ slug: "sre", user_role: "admin", can_own_agents: true }),
      ]),
    );
  });
});
