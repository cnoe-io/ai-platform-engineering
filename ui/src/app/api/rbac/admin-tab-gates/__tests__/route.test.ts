/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: (email?: string) => email === "bootstrap@example.com",
}));

const mockGetCollection = jest.fn();
jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) =>
    ({
      feedbackEnabled: true,
      npsEnabled: true,
      auditLogsEnabled: true,
      actionAuditEnabled: true,
    })[key] ?? false,
}));

const mockCheckOpenFgaTuple = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

import { GET } from "../route";

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("GET /api/rbac/admin-tab-gates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCollection.mockImplementation(() => {
      throw new Error("admin_tab_policies should not be read");
    });
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 0 });
  });

  it("returns deterministic admin gates without CEL policy storage", async () => {
    mockGetServerSession.mockResolvedValue({
      role: "admin",
      sub: "admin-sub",
      user: { email: "admin@example.com" },
    });
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockGetCollection).not.toHaveBeenCalledWith("admin_tab_policies");
    expect(body.gates).toMatchObject({
      users: true,
      teams: true,
      skills: true,
      metrics: true,
      health: true,
      roles: true,
      identity_group_sync: true,
      slack: true,
      webex: true,
      action_audit: true,
      openfga: true,
      migrations: true,
    });
    expect(body.gates).not.toHaveProperty("policy");
  });

  it("does not use organization admin alone for privileged tab visibility", async () => {
    mockGetServerSession.mockResolvedValue({
      role: "admin",
      sub: "admin-sub",
      user: { email: "admin@example.com" },
    });
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { user: string; relation: string; object: string }) => ({
      allowed:
        tuple.user === "user:admin-sub" &&
        tuple.relation === "can_manage" &&
        tuple.object === "organization:caipe" ||
        tuple.user === "user:admin-sub" &&
        tuple.relation === "can_read" &&
        [
          "admin_surface:users",
          "admin_surface:teams",
          "admin_surface:skills",
          "admin_surface:metrics",
          "admin_surface:health",
        ].includes(tuple.object),
    }));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.gates).toMatchObject({
      users: true,
      teams: true,
      skills: true,
      metrics: true,
      health: true,
      slack: false,
      webex: false,
      openfga: false,
      migrations: false,
    });
  });

  it("allows baseline tabs for non-admin users and hides admin surfaces", async () => {
    mockGetServerSession.mockResolvedValue({
      role: "user",
      sub: "user-sub",
      user: { email: "user@example.com" },
    });
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { user: string; relation: string; object: string }) => ({
      allowed:
        tuple.user === "user:user-sub" &&
        tuple.relation === "can_read" &&
        [
          "admin_surface:users",
          "admin_surface:teams",
          "admin_surface:skills",
          "admin_surface:metrics",
          "admin_surface:health",
        ].includes(tuple.object),
    }));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.gates).toMatchObject({
      users: true,
      teams: true,
      skills: true,
      metrics: true,
      health: true,
      roles: false,
      identity_group_sync: false,
      slack: false,
      webex: false,
      action_audit: false,
      openfga: false,
      migrations: false,
    });
  });

  it("repairs baseline member tuples before evaluating non-admin tab gates", async () => {
    mockGetServerSession.mockResolvedValue({
      role: "user",
      sub: "user-sub",
      user: { email: "user@example.com" },
    });
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { user: string; relation: string; object: string }) => ({
      allowed:
        tuple.user === "user:user-sub" &&
        tuple.relation === "can_read" &&
        tuple.object === "admin_surface:users",
    }));

    const res = await GET();

    expect(res.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        { user: "user:user-sub", relation: "member", object: "organization:caipe" },
        { user: "user:user-sub", relation: "reader", object: "admin_surface:users" },
      ]),
      deletes: [],
    });
  });

  it("shows Slack and Webex tabs when a non-admin can manage concrete messaging resources", async () => {
    mockGetServerSession.mockResolvedValue({
      role: "user",
      sub: "user-sub",
      user: { email: "user@example.com" },
    });
    mockGetCollection.mockImplementation((name: string) => {
      if (name === "channel_team_mappings") {
        return {
          find: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue([
              { slack_workspace_id: "T123", slack_channel_id: "C123", active: true },
            ]),
          }),
        };
      }
      if (name === "webex_space_team_mappings") {
        return {
          find: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue([
              { webex_workspace_id: "WX", webex_space_id: "space-1", active: true },
            ]),
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    });
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { user: string; relation: string; object: string }) => ({
      allowed:
        tuple.user === "user:user-sub" &&
        tuple.relation === "can_manage" &&
        ["slack_channel:T123--C123", "webex_space:WX--space-1"].includes(tuple.object),
    }));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.gates).toMatchObject({
      slack: true,
      webex: true,
      openfga: false,
    });
  });

  it("can simulate admin tab gates for a real team userset", async () => {
    mockGetServerSession.mockResolvedValue({
      role: "admin",
      sub: "admin-sub",
      user: { email: "admin@example.com" },
    });
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { user: string; relation: string; object: string }) => ({
      allowed:
        tuple.user === "user:admin-sub" && tuple.relation === "can_manage" && tuple.object === "organization:caipe" ||
        tuple.user === "team:platform#admin" && tuple.relation === "can_read" && [
          "admin_surface:users",
          "admin_surface:teams",
          "admin_surface:skills",
          "admin_surface:metrics",
          "admin_surface:health",
        ].includes(tuple.object) ||
        tuple.user === "team:platform#admin" && tuple.relation === "can_manage" && tuple.object === "admin_surface:slack",
    }));

    const res = await GET(
      request("/api/rbac/admin-tab-gates?simulate_type=team&simulate_id=platform&simulate_relation=admin")
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.simulation).toMatchObject({
      active: true,
      readonly: true,
      subject: {
        type: "team",
        id: "platform",
        relation: "admin",
        openfga_user: "team:platform#admin",
      },
    });
    expect(body.gates).toMatchObject({
      users: true,
      teams: true,
      skills: true,
      metrics: true,
      health: true,
      slack: true,
      webex: false,
      openfga: false,
      migrations: false,
    });
  });

  it("rejects simulation requests from non-admin actors", async () => {
    mockGetServerSession.mockResolvedValue({
      role: "user",
      sub: "user-sub",
      user: { email: "user@example.com" },
    });
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });

    const res = await GET(
      request("/api/rbac/admin-tab-gates?simulate_type=user&simulate_id=target-sub")
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Simulation requires organization admin access");
  });
});
