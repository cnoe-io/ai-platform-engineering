/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckPermission = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockReadOpenFgaTuples = jest.fn();

const provenanceRows = [
  {
    subject: { type: "team", id: "platform", relation: "member" },
    action: "use",
    resource: { type: "agent", id: "incident-agent" },
    source_type: "manual",
    source_id: "change-set-1",
    status: "active",
    created_at: "2026-05-12T00:00:00.000Z",
  },
];

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "alice-sub",
    email: "alice@example.com",
    name: "Alice Admin",
  })),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
  logGraphQueryAuditEvent: jest.fn(),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async () => ({
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(provenanceRows) }),
      toArray: jest.fn().mockResolvedValue(provenanceRows),
    }),
  })),
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: { Authorization: "Bearer test-token" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
  const tuples = [
    {
      key: {
        user: "team:platform#member",
        relation: "user",
        object: "agent:incident-agent",
      },
      timestamp: "2026-05-12T00:00:01.000Z",
    },
    {
      key: {
        user: "slack_channel:C123",
        relation: "user",
        object: "agent:incident-agent",
      },
      timestamp: "2026-05-12T00:00:02.000Z",
    },
  ];
  mockReadOpenFgaTuples.mockImplementation(async (request?: { tuple?: { user?: string } }) => ({
    tuples: request?.tuple?.user
      ? tuples.filter((tuple) => tuple.key.user === request.tuple?.user)
      : tuples,
  }));
});

describe("GET /api/admin/rebac/graph", () => {
  it("returns all relationship graph edges with source metadata", async () => {
    const { GET } = await import("../graph/route");

    const response = await GET(request("/api/admin/rebac/graph?limit=100"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.edges).toHaveLength(2);
    expect(body.data.edges[0]).toMatchObject({
      from: "team:platform#member",
      to: "agent:incident-agent",
      relation: "user",
      source: { source_type: "manual", source_id: "change-set-1" },
    });
  });

  it("filters by team, resource, subject, and Slack channel scopes", async () => {
    const { GET } = await import("../graph/route");

    const byTeam = await (await GET(request("/api/admin/rebac/graph?team=platform"))).json();
    expect(byTeam.data.edges).toHaveLength(1);

    const byResource = await (
      await GET(request("/api/admin/rebac/graph?resource_type=agent&resource_id=incident-agent"))
    ).json();
    expect(byResource.data.edges).toHaveLength(2);

    const bySubject = await (
      await GET(request("/api/admin/rebac/graph?subject=team:platform%23member"))
    ).json();
    expect(bySubject.data.edges).toHaveLength(1);

    const bySlack = await (await GET(request("/api/admin/rebac/graph?slack_channel=C123"))).json();
    expect(bySlack.data.edges).toHaveLength(1);
  });

  it("handles typed wildcard user subjects without passing user:* as an OpenFGA read filter", async () => {
    mockReadOpenFgaTuples.mockImplementation(async (readRequest?: { tuple?: { user?: string } }) => {
      if (readRequest?.tuple?.user === "user:*") {
        throw new Error("OpenFGA rejects typed wildcard tuple-key read filters");
      }
      return {
        tuples: [
          {
            key: { user: "user:*", relation: "user", object: "agent:default-agent" },
            timestamp: "2026-05-12T00:00:03.000Z",
          },
          {
            key: { user: "team:platform#member", relation: "user", object: "agent:incident-agent" },
            timestamp: "2026-05-12T00:00:01.000Z",
          },
        ],
      };
    });
    const { GET } = await import("../graph/route");

    const response = await GET(request("/api/admin/rebac/graph?subject=user%3A*&limit=100"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.edges).toEqual([
      expect.objectContaining({
        from: "user:*",
        relation: "user",
        to: "agent:default-agent",
      }),
    ]);
    expect(mockReadOpenFgaTuples).not.toHaveBeenCalledWith(
      expect.objectContaining({ tuple: { user: "user:*" } }),
    );
  });
});
