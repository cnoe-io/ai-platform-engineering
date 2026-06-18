/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { RBAC_COLLECTION_NAMES } from "@/lib/rbac/mongo-collections";

const teamId = new ObjectId().toHexString();
const mockCollections: Record<string, ReturnType<typeof createMockCollection>> = {};

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: jest.fn(async () => ({ allowed: true })),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: jest.fn(async () => ({ allowed: true })),
  writeOpenFgaTupleDiff: jest.fn(async () => ({ enabled: true, writes: 2, deletes: 0 })),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: jest.fn(async () => undefined),
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "alice-sub",
    email: "alice@example.com",
    name: "Alice",
  })),
}));

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async (name: string) => mockCollections[name] ?? createMockCollection([])),
}));

jest.mock("@/lib/rbac/mongo-collections", () => {
  const actual = jest.requireActual("@/lib/rbac/mongo-collections");
  return {
    ...actual,
    getRbacCollection: jest.fn(async (key: keyof typeof actual.RBAC_COLLECTION_NAMES) => {
      const name = actual.RBAC_COLLECTION_NAMES[key];
      return mockCollections[name] ?? createMockCollection([]);
    }),
  };
});

jest.mock("@/lib/config", () => ({ getConfig: () => true }));
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

function createMockCollection(rows: Record<string, unknown>[]) {
  return {
    rows,
    find: jest.fn((filter: Record<string, unknown> = {}) => ({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue(
        rows.filter((row) => {
          if (filter.active && typeof filter.active === "object" && "$ne" in filter.active) {
            if (row.active === (filter.active as { $ne: unknown }).$ne) return false;
          }
          if (filter.webex_space_id && typeof filter.webex_space_id === "object" && "$in" in filter.webex_space_id) {
            if (!(filter.webex_space_id.$in as string[]).includes(String(row.webex_space_id))) return false;
          } else if (filter.webex_space_id !== undefined && row.webex_space_id !== filter.webex_space_id) {
            return false;
          }
          if (filter.team_id && typeof filter.team_id === "object" && "$ne" in filter.team_id) {
            if (row.team_id === (filter.team_id as { $ne: unknown }).$ne) return false;
          } else if (filter.team_id !== undefined && row.team_id !== filter.team_id) {
            return false;
          }
          return true;
        })
      ),
    })),
    findOne: jest.fn(async (filter: Record<string, unknown>) => {
      if (filter._id) {
        return rows.find((row) => String(row._id) === String(filter._id)) ?? null;
      }
      return null;
    }),
    updateOne: jest.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert?: boolean }) => {
      let row = rows.find((candidate) => {
        if (filter.webex_space_id !== undefined && candidate.webex_space_id !== filter.webex_space_id) {
          return false;
        }
        if (filter.team_id !== undefined && candidate.team_id !== filter.team_id) {
          return false;
        }
        return true;
      });
      if (!row && options?.upsert) {
        row = { ...filter, ...(update.$set as object), ...(update.$setOnInsert as object) };
        rows.push(row);
      } else if (row && update.$set) {
        Object.assign(row, update.$set);
      }
      return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0, upsertedCount: row && options?.upsert ? 1 : 0 };
    }),
    updateMany: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
  mockCollections.teams = createMockCollection([{ _id: teamId, slug: "team-a", name: "Team A" }]);
  mockCollections[RBAC_COLLECTION_NAMES.webexSpaceTeamMappings] = createMockCollection([]);
  process.env.WEBEX_WORKSPACE_ALIAS = "CAIPE-WEBEX";
});

afterEach(() => {
  delete process.env.WEBEX_WORKSPACE_ALIAS;
});

describe("PUT /api/admin/teams/[id]/webex-spaces", () => {
  it("upserts by webex_space_id and team_id and rejects cross-team conflicts", async () => {
    mockCollections[RBAC_COLLECTION_NAMES.webexSpaceTeamMappings].rows.push({
      webex_space_id: "space-taken",
      team_id: "other-team",
      active: true,
    });

    const { PUT } = await import("../webex-spaces/route");
    const conflict = await PUT(
      new NextRequest(`http://localhost:3000/api/admin/teams/${teamId}/webex-spaces`, {
        method: "PUT",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          spaces: [{ webex_space_id: "space-taken", space_name: "Taken Space" }],
        }),
      }),
      { params: Promise.resolve({ id: teamId }) }
    );
    expect(conflict.status).toBe(409);

    const ok = await PUT(
      new NextRequest(`http://localhost:3000/api/admin/teams/${teamId}/webex-spaces`, {
        method: "PUT",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          spaces: [{ webex_space_id: "space-new", space_name: "New Space" }],
        }),
      }),
      { params: Promise.resolve({ id: teamId }) }
    );
    expect(ok.status).toBe(200);
    expect(
      mockCollections[RBAC_COLLECTION_NAMES.webexSpaceTeamMappings].updateOne
    ).toHaveBeenCalledWith(
      { webex_space_id: "space-new", team_id: teamId },
      expect.any(Object),
      { upsert: true }
    );
  });
});
