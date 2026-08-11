const mockGetRbacCollection = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getUserTeamIds: jest.fn(async () => []),
}));

jest.mock("@/lib/rbac/mongo-collections", () => ({
  getRbacCollection: (...args: unknown[]) => mockGetRbacCollection(...args),
}));

jest.mock("@/lib/rbac/organization", () => ({ caipeOrgKey: () => "example" }));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: jest.fn(async () => undefined),
}));

import { canAssignProjectToTeam } from "@/lib/projects/project-admin";

describe("project team assignment", () => {
  const findOne = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRbacCollection.mockReturnValue({ findOne });
  });

  it("allows an organization admin without a membership lookup", async () => {
    await expect(
      canAssignProjectToTeam({ slug: "primary" }, "admin@example.test", true),
    ).resolves.toBe(true);
    expect(mockGetRbacCollection).not.toHaveBeenCalled();
  });

  it("requires an active canonical membership for a regular user", async () => {
    findOne.mockResolvedValue({ status: "active" });
    await expect(
      canAssignProjectToTeam({ slug: "primary" }, " User@Example.Test ", false),
    ).resolves.toBe(true);
    expect(findOne).toHaveBeenCalledWith({
      status: "active",
      user_email: "user@example.test",
      team_slug: "primary",
    });
  });

  it("denies a user without an active membership", async () => {
    findOne.mockResolvedValue(null);
    await expect(
      canAssignProjectToTeam({ slug: "primary" }, "user@example.test", false),
    ).resolves.toBe(false);
  });

  it.each([
    ["missing email", { slug: "primary" }, undefined],
    ["blank email", { slug: "primary" }, "   "],
    ["missing team slug", {}, "user@example.test"],
    ["blank team slug", { slug: "   " }, "user@example.test"],
  ])("denies %s without querying membership", async (_label, team, email) => {
    await expect(
      canAssignProjectToTeam(team, email, false),
    ).resolves.toBe(false);
    expect(mockGetRbacCollection).not.toHaveBeenCalled();
  });
});
