/**
 * @jest-environment node
 */

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
      action_audit: true,
      openfga: true,
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
      action_audit: false,
      openfga: false,
    });
  });
});
