/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckPermission = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockReadOpenFgaTuples = jest.fn();
const mockGetCollection = jest.fn();

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
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
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
  mockGetCollection.mockImplementation(async (name: string) => {
    if (name === "rebac_relationships") {
      return collection(provenanceRows);
    }
    if (name === "teams") {
      return collection([{ _id: "team-1", slug: "platform", name: "Platform" }]);
    }
    if (name === "channel_team_mappings") {
      return collection([
        {
          slack_workspace_id: "CAIPE",
          slack_channel_id: "C123",
          channel_name: "#incidents",
          team_id: "team-1",
          team_slug: "platform",
          active: true,
          status: "active",
        },
      ]);
    }
    if (name === "webex_space_team_mappings") {
      return collection([
        {
          workspace_id: "Cisco",
          space_id: "space-1",
          space_name: "War Room",
          team_id: "team-1",
          team_slug: "platform",
          active: true,
          status: "active",
        },
      ]);
    }
    return collection([]);
  });
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
    {
      key: {
        user: "user:alice-sub",
        relation: "member",
        object: "team:platform",
      },
      timestamp: "2026-05-12T00:00:02.500Z",
    },
    {
      key: {
        user: "team:platform#admin",
        relation: "manager",
        object: "agent:admin-agent",
      },
      timestamp: "2026-05-12T00:00:03.000Z",
    },
    {
      key: {
        user: "team:platform#admin",
        relation: "manager",
        object: "admin_surface:skills",
      },
      timestamp: "2026-05-12T00:00:04.000Z",
    },
    {
      key: {
        user: "user:alice-sub",
        relation: "owner",
        object: "user_profile:alice-sub",
      },
      timestamp: "2026-05-12T00:00:05.000Z",
    },
    {
      key: {
        user: "user:alice-sub",
        relation: "owner",
        object: "mcp_server:argocd",
      },
      timestamp: "2026-05-12T00:00:06.000Z",
    },
  ];
  mockReadOpenFgaTuples.mockImplementation(async (request?: { tuple?: { user?: string } }) => ({
    tuples: request?.tuple?.user
      ? tuples.filter((tuple) => tuple.key.user === request.tuple?.user)
      : tuples,
  }));
});

function collection(rows: unknown[]) {
  return {
    find: jest.fn(() => ({
      sort: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(rows) })),
      limit: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(rows) })),
      toArray: jest.fn().mockResolvedValue(rows),
    })),
  };
}

describe("GET /api/admin/rebac/graph", () => {
  it("returns all relationship graph edges with source metadata", async () => {
    const { GET } = await import("../graph/route");

    const response = await GET(request("/api/admin/rebac/graph?limit=100"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.edges).toHaveLength(9);
    expect(body.data.edges[0]).toMatchObject({
      from: "team:platform#member",
      to: "agent:incident-agent",
      relation: "user",
      source: { source_type: "manual", source_id: "change-set-1" },
    });
    expect(body.data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "slack_channel:CAIPE--C123",
          to: "team:platform",
          relation: "assigned_team",
          kind: "metadata",
          metadata: expect.objectContaining({
            source_type: "slack_channel_team_mapping",
            readonly: true,
          }),
        }),
        expect.objectContaining({
          from: "webex_space:Cisco--space-1",
          to: "team:platform",
          relation: "assigned_team",
          kind: "metadata",
          metadata: expect.objectContaining({
            source_type: "webex_space_team_mapping",
            readonly: true,
          }),
        }),
      ]),
    );
  });

  it("filters by team, resource, subject, and Slack channel scopes", async () => {
    const { GET } = await import("../graph/route");

    const byTeam = await (await GET(request("/api/admin/rebac/graph?team=platform"))).json();
    expect(byTeam.data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "team:platform#member", to: "agent:incident-agent" }),
        expect.objectContaining({ from: "team:platform#admin", to: "agent:admin-agent", relation: "manager" }),
        expect.objectContaining({ from: "team:platform#admin", to: "admin_surface:skills", relation: "manager" }),
        expect.objectContaining({ from: "slack_channel:CAIPE--C123", to: "team:platform" }),
        expect.objectContaining({ from: "webex_space:Cisco--space-1", to: "team:platform" }),
      ]),
    );

    const byResource = await (
      await GET(request("/api/admin/rebac/graph?resource_type=agent&resource_id=incident-agent"))
    ).json();
    expect(byResource.data.edges).toHaveLength(2);

    const byAdminSurface = await (
      await GET(request("/api/admin/rebac/graph?resource_type=admin_surface&resource_id=skills"))
    ).json();
    expect(byAdminSurface.data.edges).toEqual([
      expect.objectContaining({ from: "team:platform#admin", to: "admin_surface:skills", relation: "manager" }),
    ]);

    const bySubject = await (
      await GET(request("/api/admin/rebac/graph?subject=user%3Aalice-sub"))
    ).json();
    expect(bySubject.data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "user:alice-sub", to: "user_profile:alice-sub", relation: "owner" }),
        expect.objectContaining({ from: "user:alice-sub", to: "mcp_server:argocd", relation: "owner" }),
        expect.objectContaining({ from: "team:platform#member", to: "agent:incident-agent", relation: "user" }),
      ]),
    );

    const bySlack = await (await GET(request("/api/admin/rebac/graph?slack_channel=C123"))).json();
    expect(bySlack.data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "slack_channel:C123", to: "agent:incident-agent" }),
        expect.objectContaining({ from: "slack_channel:CAIPE--C123", to: "team:platform" }),
      ]),
    );
  });

  it("returns effective access edges for a selected subject", async () => {
    const { GET } = await import("../graph/route");

    const response = await GET(request("/api/admin/rebac/graph?subject=user%3Aalice-sub&layer=effective&limit=100"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.scope).toMatchObject({ subject: "user:alice-sub", layer: "effective" });
    expect(body.data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "user:alice-sub",
          to: "agent:incident-agent",
          relation: "can_use",
          kind: "effective",
          layer: "effective",
        }),
        expect.objectContaining({
          from: "user:alice-sub",
          to: "user_profile:alice-sub",
          relation: "can_manage",
          kind: "effective",
          layer: "effective",
        }),
      ]),
    );
  });

  it("keeps effective access empty until a subject is selected", async () => {
    const { GET } = await import("../graph/route");

    const response = await GET(request("/api/admin/rebac/graph?layer=effective&limit=100"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.scope).toMatchObject({ layer: "effective" });
    expect(body.data.nodes).toEqual([]);
    expect(body.data.edges).toEqual([]);
  });

  it("returns authorization model topology derived from the universal resource model", async () => {
    const { GET } = await import("../graph/route");

    const response = await GET(request("/api/admin/rebac/graph?layer=model&limit=1000"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.scope).toMatchObject({ layer: "model" });
    expect(body.data.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "model:resource_type:secret_ref", type: "model_resource_type" }),
        expect.objectContaining({ id: "model:relation:secret_ref:metadata_reader", type: "model_relation" }),
        expect.objectContaining({ id: "model:permission:secret_ref:can_read_metadata", type: "model_permission" }),
      ]),
    );
    expect(body.data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "model:resource_type:secret_ref",
          to: "model:relation:secret_ref:metadata_reader",
          relation: "read-metadata",
          kind: "model",
          layer: "model",
        }),
        expect.objectContaining({
          from: "model:relation:secret_ref:metadata_reader",
          to: "model:permission:secret_ref:can_read_metadata",
          relation: "derives",
          kind: "model",
          layer: "model",
        }),
      ]),
    );
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
