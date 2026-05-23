/**
 * @jest-environment node
 */

const mockGetCollection = jest.fn();
const mockWriteOpenFgaTupleDiff = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTupleDiff: (...args: unknown[]) => mockWriteOpenFgaTupleDiff(...args),
}));

import { grantSkillsToTeams, buildSkillTeamGrantTuples } from "../skill-team-grants";

describe("skill team grants", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteOpenFgaTupleDiff.mockResolvedValue({ enabled: true, writes: 0, deletes: 0 });
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
});
