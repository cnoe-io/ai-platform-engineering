/**
 * @jest-environment node
 *
 * #48 regression: GET /api/auth/my-roles must return the team `slug` (the
 * canonical OpenFGA team:<slug> identity) on each team — not just the Mongo
 * `_id` (ObjectId). The Service Accounts owning-team picker submits this value
 * as `owning_team_id`, and the create route checks `member team:<slug>`. If the
 * response omitted `slug` (or the picker used `_id`), the membership check
 * missed the seeded `team:<slug>#member` tuple → 403 "not a member of the
 * owning team" for a team the caller IS in.
 */

const mockGetServerSession = jest.fn();
const mockGetRbacCollection = jest.fn();
const mockGetCollection = jest.fn();
const mockGetRealmUserById = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));
jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));
jest.mock("@/lib/rbac/mongo-collections", () => ({
  getRbacCollection: (...args: unknown[]) => mockGetRbacCollection(...args),
}));
jest.mock("@/lib/rbac/keycloak-admin", () => ({
  getRealmUserById: (...args: unknown[]) => mockGetRealmUserById(...args),
}));

import { GET } from "../my-roles/route";

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({
    user: { email: "erik@example.com", name: "Erik" },
    role: "user",
    sub: "a02e2c8c-0000-0000-0000-000000000000",
  });
  // team_membership_sources: Erik is a member of team-sre (keyed by SLUG).
  mockGetRbacCollection.mockResolvedValue({
    find: () => ({
      toArray: async () => [
        { team_slug: "team-sre", user_email: "erik@example.com", relationship: "member", status: "active" },
      ],
    }),
  });
  // teams collection: the doc has a Mongo ObjectId _id DISTINCT from the slug.
  mockGetCollection.mockResolvedValue({
    find: () => ({
      project: () => ({
        toArray: async () => [
          { _id: { toString: () => "665f1a2b3c4d5e6f70819203" }, name: "SRE", slug: "team-sre" },
        ],
      }),
    }),
  });
  mockGetRealmUserById.mockResolvedValue({ attributes: {} });
});

describe("GET /api/auth/my-roles teams[]", () => {
  it("returns slug (canonical team identity) distinct from the Mongo _id (#48)", async () => {
    const res = await GET();
    const body = (await res.json()) as {
      teams: Array<{ _id: string; slug: string; name: string; role?: string }>;
    };

    expect(body.teams).toHaveLength(1);
    const team = body.teams[0];
    // The slug — what the SA owning-team picker must submit — is present and
    // equals the membership-source slug, NOT the ObjectId.
    expect(team.slug).toBe("team-sre");
    expect(team._id).toBe("665f1a2b3c4d5e6f70819203");
    expect(team.slug).not.toBe(team._id);
    expect(team.name).toBe("SRE");
    expect(team.role).toBe("member");
  });

  it("401s when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
