/**
 * @jest-environment node
 */

const mockGetCollection = jest.fn();
const mockWriteOpenFgaTupleDiff = jest.fn();
const mockReconcileShareableResource = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTupleDiff: (...args: unknown[]) => mockWriteOpenFgaTupleDiff(...args),
}));

jest.mock("@/lib/rbac/openfga-owned-resources", () => ({
  reconcileShareableResource: (...args: unknown[]) => mockReconcileShareableResource(...args),
}));

import {
  grantSkillsToTeams,
  buildSkillTeamGrantTuples,
  reconcileSkillTeamShares,
} from "../skill-team-grants";

function emptyTeamsCollection() {
  return {
    find: jest.fn().mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    }),
  };
}

describe("skill team grants", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteOpenFgaTupleDiff.mockResolvedValue({ enabled: true, writes: 0, deletes: 0 });
    mockReconcileShareableResource.mockResolvedValue({ enabled: true, writes: 0, deletes: 0 });
  });

  it("builds team-member skill user tuples for every selected team and skill", () => {
    expect(buildSkillTeamGrantTuples(["platform", "sre"], ["skill-one", "skill-two"])).toEqual([
      { user: "team:platform#member", relation: "user", object: "skill:skill-one" },
      { user: "team:platform#member", relation: "user", object: "skill:skill-two" },
      { user: "team:sre#member", relation: "user", object: "skill:skill-one" },
      { user: "team:sre#member", relation: "user", object: "skill:skill-two" },
    ]);
  });

  it("resolves ObjectId team refs to immutable team slugs before writing OpenFGA tuples", async () => {
    const teams = {
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([
            { _id: "507f1f77bcf86cd799439011", slug: "platform" },
          ]),
        }),
      }),
    };
    mockGetCollection.mockResolvedValue(teams);

    const result = await grantSkillsToTeams({
      teamRefs: ["507f1f77bcf86cd799439011"],
      skillIds: ["skill-imported"],
    });

    expect(result.teamSlugs).toEqual(["platform"]);
    expect(mockWriteOpenFgaTupleDiff).toHaveBeenCalledWith({
      writes: [
        { user: "team:platform#member", relation: "user", object: "skill:skill-imported" },
      ],
      deletes: [],
    });
  });

  it("uses slug-like refs directly when no team document is found", async () => {
    const teams = {
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([]),
        }),
      }),
    };
    mockGetCollection.mockResolvedValue(teams);

    await grantSkillsToTeams({
      teamRefs: ["platform"],
      skillIds: ["hub-h1-s1"],
    });

    expect(mockWriteOpenFgaTupleDiff).toHaveBeenCalledWith({
      writes: [
        { user: "team:platform#member", relation: "user", object: "skill:hub-h1-s1" },
      ],
      deletes: [],
    });
  });

  describe("reconcileSkillTeamShares", () => {
    it("routes a single skill's share diff through the shared shareable-resource reconciler", async () => {
      mockGetCollection.mockResolvedValue(emptyTeamsCollection());

      await reconcileSkillTeamShares({
        skillId: "skill-x",
        previousTeamRefs: ["platform", "sre"],
        nextTeamRefs: ["platform"],
      });

      // Skills are user-owned (no owner team); only the shared-team set is
      // reconciled, with the skill member relation `user`. Passing the previous
      // set is what lets the shared reconciler emit the revoke for "sre".
      expect(mockReconcileShareableResource).toHaveBeenCalledWith({
        objectType: "skill",
        objectId: "skill-x",
        ownerTeamSlug: null,
        nextSharedTeamSlugs: ["platform"],
        previousSharedTeamSlugs: ["platform", "sre"],
        memberRelations: ["user"],
      });
    });

    it("normalizes empty/undefined ref lists to empty sets (full revoke / no-op)", async () => {
      mockGetCollection.mockResolvedValue(emptyTeamsCollection());

      await reconcileSkillTeamShares({
        skillId: "skill-y",
        previousTeamRefs: ["platform"],
        nextTeamRefs: undefined,
      });

      expect(mockReconcileShareableResource).toHaveBeenCalledWith(
        expect.objectContaining({
          objectId: "skill-y",
          nextSharedTeamSlugs: [],
          previousSharedTeamSlugs: ["platform"],
        }),
      );
    });
  });
});
