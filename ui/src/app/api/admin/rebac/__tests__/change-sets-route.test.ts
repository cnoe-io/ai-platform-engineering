/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckPermission = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockLogPolicyChangeAuditEvent = jest.fn();

const mockCollections: Record<string, any> = {};

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
  logPolicyChangeAuditEvent: (...args: unknown[]) => mockLogPolicyChangeAuditEvent(...args),
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "alice-sub",
    email: "alice@example.com",
    name: "Alice Admin",
  })),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) => mockCollections[name] ?? createMockCollection([])),
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

function createMockCollection(rows: any[]) {
  return {
    rows,
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(rows) }),
        toArray: jest.fn().mockResolvedValue(rows),
      }),
      limit: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(rows) }),
      toArray: jest.fn().mockResolvedValue(rows),
    }),
    findOne: jest.fn(async (filter: any) => rows.find((row) => row.id === filter.id) ?? null),
    insertOne: jest.fn(async (doc: any) => {
      rows.push(doc);
      return { insertedId: doc.id };
    }),
    updateOne: jest.fn(async (filter: any, update: any) => {
      const row = rows.find((candidate) => candidate.id === filter.id);
      if (row && update.$set) Object.assign(row, update.$set);
      return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
    }),
  };
}

function request(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    ...init,
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

const grant = {
  subject: { type: "team", id: "platform", relation: "member" },
  action: "use",
  resource: { type: "agent", id: "incident-agent" },
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
  mockCollections.policy_change_sets = createMockCollection([]);
  mockCollections.rebac_relationships = createMockCollection([]);
  mockCollections.policy_rules = createMockCollection([]);
  mockCollections.audit_events = createMockCollection([]);
});

describe("ReBAC change-set routes", () => {
  it("creates a draft change set from guided policy relationships", async () => {
    const { POST } = await import("../change-sets/route");

    const response = await POST(
      request("/api/admin/rebac/change-sets", {
        method: "POST",
        body: JSON.stringify({ name: "Grant agent access", writes: [grant], deletes: [] }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.change_set.status).toBe("draft");
    expect(body.data.change_set.writes).toEqual([grant]);
    expect(mockCollections.policy_change_sets.insertOne).toHaveBeenCalled();
  });

  it("validates and persists blocked relationships without applying them", async () => {
    const draft = {
      id: "change-set-1",
      name: "Invalid grant",
      status: "draft",
      writes: [{ ...grant, action: "ingest" }],
      deletes: [],
      created_by: "alice@example.com",
      created_at: "2026-05-12T00:00:00.000Z",
    };
    mockCollections.policy_change_sets = createMockCollection([draft]);
    const { POST } = await import("../change-sets/[changeSetId]/validate/route");

    const response = await POST(
      request("/api/admin/rebac/change-sets/change-set-1/validate", { method: "POST" }),
      { params: Promise.resolve({ changeSetId: "change-set-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.validation.valid).toBe(false);
    expect(body.data.validation.blocked[0].code).toBe("unsupported_action");
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("applies a valid change set atomically to OpenFGA and relationship provenance", async () => {
    const draft = {
      id: "change-set-2",
      name: "Grant agent access",
      status: "draft",
      writes: [grant],
      deletes: [],
      created_by: "alice@example.com",
      created_at: "2026-05-12T00:00:00.000Z",
    };
    mockCollections.policy_change_sets = createMockCollection([draft]);
    const { POST } = await import("../change-sets/[changeSetId]/apply/route");

    const response = await POST(
      request("/api/admin/rebac/change-sets/change-set-2/apply", { method: "POST" }),
      { params: Promise.resolve({ changeSetId: "change-set-2" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.change_set.status).toBe("applied");
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: "team:platform#member", relation: "can_use", object: "agent:incident-agent" }],
      deletes: [],
    });
    expect(mockCollections.rebac_relationships.updateOne).toHaveBeenCalledWith(
      {
        "subject.type": "team",
        "subject.id": "platform",
        "subject.relation": "member",
        action: "use",
        "resource.type": "agent",
        "resource.id": "incident-agent",
      },
      expect.objectContaining({ $set: expect.objectContaining({ status: "active" }) }),
      { upsert: true }
    );
    expect(mockLogPolicyChangeAuditEvent).toHaveBeenCalled();
  });

  it("rejects re-applying an already applied change set", async () => {
    const applied = {
      id: "change-set-applied",
      name: "Already applied",
      status: "applied",
      writes: [grant],
      deletes: [],
      created_by: "alice@example.com",
      created_at: "2026-05-12T00:00:00.000Z",
    };
    mockCollections.policy_change_sets = createMockCollection([applied]);
    const { POST } = await import("../change-sets/[changeSetId]/apply/route");

    const response = await POST(
      request("/api/admin/rebac/change-sets/change-set-applied/apply", { method: "POST" }),
      { params: Promise.resolve({ changeSetId: "change-set-applied" }) }
    );

    expect(response.status).toBe(409);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });
});
