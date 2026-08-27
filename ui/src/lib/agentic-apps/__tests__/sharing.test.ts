import {
  buildAgenticAppSharingTupleDiff,
  effectiveAgenticAppVisibility,
} from "../sharing";

describe("agentic app sharing", () => {
  it("treats legacy installations as global", () => {
    expect(effectiveAgenticAppVisibility({})).toBe("global");
  });

  it("moves a global app to private while preserving the owner", () => {
    expect(
      buildAgenticAppSharingTupleDiff({
        appId: "example-dashboard",
        ownerSubject: "user-1",
        visibility: "private",
        previousVisibility: "global",
      }),
    ).toEqual({
      writes: [
        {
          user: "user:user-1",
          relation: "owner",
          object: "agentic_app:example-dashboard",
        },
      ],
      deletes: expect.arrayContaining([
        {
          user: "user:*",
          relation: "user",
          object: "agentic_app:example-dashboard",
        },
      ]),
    });
  });

  it("migrates legacy team sharing to Viewer only", () => {
    const diff = buildAgenticAppSharingTupleDiff({
      appId: "example-dashboard",
      ownerSubject: "user-1",
      visibility: "team",
      sharedWithTeams: ["platform", "platform"],
      previousVisibility: "private",
    });

    expect(diff.writes).toEqual(
      expect.arrayContaining([
        {
          user: "team:platform#member",
          relation: "user",
          object: "agentic_app:example-dashboard",
        },
      ]),
    );
    expect(diff.writes).not.toContainEqual({
      user: "team:platform#admin",
      relation: "manager",
      object: "agentic_app:example-dashboard",
    });
  });

  it("projects each team role to its least-privilege relationship", () => {
    const diff = buildAgenticAppSharingTupleDiff({
      appId: "example-dashboard",
      ownerSubject: "user-1",
      visibility: "team",
      teamAccess: [
        { teamSlug: "viewers", role: "viewer" },
        { teamSlug: "editors", role: "editor" },
        { teamSlug: "approvers", role: "approver" },
        { teamSlug: "admins", role: "admin" },
      ],
      previousVisibility: "private",
    });

    expect(diff.writes).toEqual(expect.arrayContaining([
      { user: "team:viewers#member", relation: "user", object: "agentic_app:example-dashboard" },
      { user: "team:editors#member", relation: "writer", object: "agentic_app:example-dashboard" },
      { user: "team:approvers#member", relation: "approver", object: "agentic_app:example-dashboard" },
      { user: "team:admins#admin", relation: "manager", object: "agentic_app:example-dashboard" },
    ]));
  });

  it("rejects unsafe resource identifiers", () => {
    expect(() =>
      buildAgenticAppSharingTupleDiff({
        appId: "bad id",
        ownerSubject: "user-1",
        visibility: "private",
      }),
    ).toThrow("Invalid OpenFGA agentic app id");
  });
});
