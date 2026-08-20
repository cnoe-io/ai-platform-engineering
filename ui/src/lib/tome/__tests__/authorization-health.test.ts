import {
  reconcileTomeAuthorization,
  repairTomeAuthorizationForProject,
} from "@/lib/tome/authorization-health";
import type { OpenFgaTupleKey } from "@/lib/rbac/openfga";
import type { ProjectDocument } from "@/types/projects";

const mockGetCollection = jest.fn();
const mockReadOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockListActiveBySlug = jest.fn();
const mockListActiveForUser = jest.fn();
const mockUpsertSource = jest.fn();
const mockResolveStoredSteward = jest.fn();
const mockReadTeamTuples = jest.fn();
const mockAuditTome = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/team-membership-source-store", () => ({
  listActiveTeamMembershipSourcesBySlug: (...args: unknown[]) => mockListActiveBySlug(...args),
  listActiveTeamMembershipSourcesForTeamUser: (...args: unknown[]) =>
    mockListActiveForUser(...args),
  upsertTeamMembershipSource: (...args: unknown[]) => mockUpsertSource(...args),
}));

jest.mock("@/lib/rbac/team-membership-sync", () => ({
  mongoRoleToOpenFgaRelations: (role: string) =>
    role === "admin" ? ["admin", "member"] : ["member"],
  resolveKeycloakUserSubject: jest.fn(),
}));

jest.mock("@/lib/rbac/team-openfga-sync-status", () => ({
  readTeamOpenFgaTuples: (...args: unknown[]) => mockReadTeamTuples(...args),
}));

jest.mock("@/lib/tome/access", () => ({
  tomeDataObject: (project: ProjectDocument) =>
    `document:tome/${project.type ?? "project"}/${String(project._id)}`,
}));

jest.mock("@/lib/tome/steward-identity", () => ({
  dataStewardOpenFgaSubject: (steward: { type: string; id: string }) =>
    steward.type === "team" ? `team:${steward.id}#member` : `user:${steward.id}`,
  resolveStoredDataSteward: (...args: unknown[]) => mockResolveStoredSteward(...args),
}));

jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAuditTome(...args),
}));

function project(): ProjectDocument {
  return {
    _id: "project-id",
    type: "project",
    slug: "example",
    title: "Example",
    description: "",
    team_id: "team-id",
    team_slug: "primary",
    team_name: "Primary",
    owner_id: "owner@example.test",
    member_ids: [],
    domain: "default",
    tags: [],
    status: "active",
    catalog: {} as ProjectDocument["catalog"],
    components: [],
    onboarding: {},
    integrations: {},
    data_steward: { type: "team", id: "data-stewards", name: "Data Stewards" },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function source(overrides: Record<string, unknown> = {}) {
  return {
    team_id: "team-id",
    team_slug: "data-stewards",
    user_email: "member@example.test",
    user_subject: "member-sub",
    relationship: "member",
    source_type: "manual",
    managed: false,
    status: "active",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("Tome authorization reconciliation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveStoredSteward.mockResolvedValue({
      type: "team",
      id: "data-stewards",
      name: "Data Stewards",
    });
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [] });
    mockWriteOpenFgaTuples.mockImplementation(
      ({ writes }: { writes: OpenFgaTupleKey[] }) =>
        Promise.resolve({ enabled: true, writes: writes.length, deletes: 0 }),
    );
    mockListActiveForUser.mockResolvedValue([source()]);
    mockListActiveBySlug.mockResolvedValue([source()]);
    mockReadTeamTuples.mockResolvedValue([]);
    mockUpsertSource.mockResolvedValue(undefined);
  });

  it("repairs the document writer and canonical caller membership", async () => {
    await expect(
      repairTomeAuthorizationForProject({
        project: project(),
        userSubject: "member-sub",
        userEmail: "member@example.test",
      }),
    ).resolves.toBe(2);

    expect(mockWriteOpenFgaTuples).toHaveBeenNthCalledWith(1, {
      writes: [
        {
          user: "team:data-stewards#member",
          relation: "writer",
          object: "document:tome/project/project-id",
        },
      ],
      deletes: [],
    });
    expect(mockWriteOpenFgaTuples).toHaveBeenNthCalledWith(2, {
      writes: [
        {
          user: "user:member-sub",
          relation: "member",
          object: "team:data-stewards",
        },
      ],
      deletes: [],
    });
  });

  it("does not invent team membership when no active source proves it", async () => {
    mockListActiveForUser.mockResolvedValue([]);

    await repairTomeAuthorizationForProject({
      project: project(),
      userSubject: "unrelated-sub",
      userEmail: "unrelated@example.test",
    });

    expect(mockWriteOpenFgaTuples).toHaveBeenCalledTimes(1);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalledWith(
      expect.objectContaining({
        writes: expect.arrayContaining([
          expect.objectContaining({ user: "user:unrelated-sub", object: "team:data-stewards" }),
        ]),
      }),
    );
  });

  it("reports repaired drift as healthy after a full auto-repair pass", async () => {
    const stored = new Set<string>();
    mockReadOpenFgaTuples.mockImplementation(
      ({ tuple }: { tuple: OpenFgaTupleKey }) =>
        Promise.resolve({ tuples: stored.has(JSON.stringify(tuple)) ? [{ key: tuple }] : [] }),
    );
    mockWriteOpenFgaTuples.mockImplementation(
      ({ writes }: { writes: OpenFgaTupleKey[] }) => {
        writes.forEach((tuple) => stored.add(JSON.stringify(tuple)));
        return Promise.resolve({ enabled: true, writes: writes.length, deletes: 0 });
      },
    );

    const healthCollection = {
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      deleteOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const projectsCollection = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([project()]) }),
    };
    mockGetCollection.mockImplementation((name: string) =>
      name === "projects" ? projectsCollection : healthCollection,
    );

    const health = await reconcileTomeAuthorization({ trigger: "periodic", repair: true });

    expect(health.status).toBe("healthy");
    expect(health.relationships_checked).toBe(2);
    expect(health.relationships_repaired).toBe(2);
    expect(health.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_document_writer", repaired: true }),
        expect.objectContaining({ code: "membership_drifted", repaired: true }),
      ]),
    );
    expect(mockAuditTome).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tome.authorization.auto_repair" }),
    );
  });
});
