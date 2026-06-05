/**
 * Tests for the `data_source` and `mcp_tool` OpenFGA tuple builders.
 *
 * The builders share the same shared-teams semantics as
 * `buildKnowledgeBaseRelationshipTupleDiff` so users get consistent
 * "Share with Teams" behavior across all three KB-adjacent resource
 * types. `mcp_tool` additionally emits a `user` relation per member
 * team because its model exposes `can_call` (mirroring `mcp_server`
 * invokers), so the proxy can render a Slack/agent-callable surface
 * for the team without needing a second tuple write.
 * assisted-by Cursor claude-opus-4-7
 */

import {
  buildDataSourceRelationshipTupleDiff,
  buildMcpToolRelationshipTupleDiff,
} from "@/lib/rbac/openfga-owned-resources";

describe("buildDataSourceRelationshipTupleDiff", () => {
  const DS = "data_source:ds-1";

  it("writes owner-subject and owner-team reader+manager tuples", () => {
    const diff = buildDataSourceRelationshipTupleDiff({
      dataSourceId: "ds-1",
      ownerSubject: "alice-sub",
      ownerTeamSlug: "platform",
    });

    expect(diff.writes).toEqual([
      { user: "user:alice-sub", relation: "owner", object: DS },
      { user: "team:platform#member", relation: "reader", object: DS },
      { user: "team:platform#admin", relation: "manager", object: DS },
    ]);
    expect(diff.deletes).toEqual([]);
  });

  it("adds and removes shared teams idempotently", () => {
    const diff = buildDataSourceRelationshipTupleDiff({
      dataSourceId: "ds-1",
      ownerTeamSlug: "platform",
      nextSharedTeamSlugs: ["data-eng"],
      previousSharedTeamSlugs: ["legacy"],
    });

    expect(diff.writes).toEqual(
      expect.arrayContaining([
        { user: "team:platform#member", relation: "reader", object: DS },
        { user: "team:platform#admin", relation: "manager", object: DS },
        { user: "team:data-eng#member", relation: "reader", object: DS },
        { user: "team:data-eng#admin", relation: "manager", object: DS },
      ]),
    );
    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:legacy#member", relation: "reader", object: DS },
        { user: "team:legacy#admin", relation: "manager", object: DS },
      ]),
    );
  });

  it("throws on invalid data source id", () => {
    expect(() =>
      buildDataSourceRelationshipTupleDiff({ dataSourceId: "bad id with spaces" }),
    ).toThrow("Invalid OpenFGA data source id");
  });

  it("silently drops invalid team slugs", () => {
    const diff = buildDataSourceRelationshipTupleDiff({
      dataSourceId: "ds-1",
      nextSharedTeamSlugs: ["valid-team", "bad slug"],
    });
    const userNames = diff.writes.map((t) => t.user);
    expect(userNames).toContain("team:valid-team#member");
    expect(userNames).toContain("team:valid-team#admin");
    expect(userNames).not.toContain("team:bad slug#member");
  });
});

describe("buildMcpToolRelationshipTupleDiff", () => {
  const TOOL = "mcp_tool:custom-search";

  it("emits reader, user, AND manager tuples for the owner team", () => {
    const diff = buildMcpToolRelationshipTupleDiff({
      toolId: "custom-search",
      ownerSubject: "alice-sub",
      ownerTeamSlug: "platform",
    });

    expect(diff.writes).toEqual([
      { user: "user:alice-sub", relation: "owner", object: TOOL },
      { user: "team:platform#member", relation: "reader", object: TOOL },
      { user: "team:platform#member", relation: "user", object: TOOL },
      { user: "team:platform#admin", relation: "manager", object: TOOL },
    ]);
    expect(diff.deletes).toEqual([]);
  });

  it("emits both reader and user delete tuples when revoking a shared team", () => {
    const diff = buildMcpToolRelationshipTupleDiff({
      toolId: "custom-search",
      ownerTeamSlug: "platform",
      nextSharedTeamSlugs: [],
      previousSharedTeamSlugs: ["data-eng"],
    });

    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:data-eng#member", relation: "reader", object: TOOL },
        { user: "team:data-eng#member", relation: "user", object: TOOL },
        { user: "team:data-eng#admin", relation: "manager", object: TOOL },
      ]),
    );
  });

  it("does not delete the owner team when it also appears in previousSharedTeamSlugs", () => {
    const diff = buildMcpToolRelationshipTupleDiff({
      toolId: "custom-search",
      ownerTeamSlug: "platform",
      nextSharedTeamSlugs: [],
      previousSharedTeamSlugs: ["platform"],
    });
    expect(diff.deletes).toEqual([]);
  });

  it("throws on invalid tool id", () => {
    expect(() =>
      buildMcpToolRelationshipTupleDiff({ toolId: "bad id with spaces" }),
    ).toThrow("Invalid OpenFGA mcp tool id");
  });
});
