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
jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
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

    expect(mockGetCollection).not.toHaveBeenCalled();
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

  it("allows baseline tabs for non-admin users and hides admin surfaces", async () => {
    mockGetServerSession.mockResolvedValue({
      role: "user",
      sub: "user-sub",
      user: { email: "user@example.com" },
    });

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

  it("can simulate admin tab gates for a real team userset", async () => {
    mockGetServerSession.mockResolvedValue({
      role: "admin",
      sub: "admin-sub",
      user: { email: "admin@example.com" },
    });
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { user: string; relation: string; object: string }) => ({
      allowed:
        tuple.user === "user:admin-sub" && tuple.relation === "can_manage" && tuple.object === "organization:caipe" ||
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
