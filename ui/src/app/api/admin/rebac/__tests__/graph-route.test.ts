/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckPermission = jest.fn();
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
  mockReadOpenFgaTuples.mockResolvedValue({
    tuples: [
      {
        key: {
          user: "team:platform#member",
          relation: "can_use",
          object: "agent:incident-agent",
        },
        timestamp: "2026-05-12T00:00:01.000Z",
      },
      {
        key: {
          user: "slack_channel:C123",
          relation: "can_use",
          object: "agent:incident-agent",
        },
        timestamp: "2026-05-12T00:00:02.000Z",
      },
    ],
  });
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
      relation: "can_use",
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
});
