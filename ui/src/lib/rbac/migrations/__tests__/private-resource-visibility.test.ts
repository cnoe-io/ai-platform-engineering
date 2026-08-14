jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
jest.mock("@/lib/credentials/secret-openfga", () => ({
  reconcileSecretRefOwnerRelationships: jest.fn(),
}));
jest.mock("@/lib/rbac/openfga-owned-resources-reconcile", () => ({
  reconcileConfigDrivenMcpServerRelationships: jest.fn(),
  reconcileMcpServerRelationships: jest.fn(),
}));

import {
  applyPrivateResourceVisibilityMigration,
  classifyLegacyMcpVisibility,
  classifyLegacySecretVisibility,
  derivePrivateResourceVisibilityPlan,
} from "../private-resource-visibility";
import { getCollection } from "@/lib/mongodb";
import { reconcileSecretRefOwnerRelationships } from "@/lib/credentials/secret-openfga";
import {
  reconcileConfigDrivenMcpServerRelationships,
  reconcileMcpServerRelationships,
} from "@/lib/rbac/openfga-owned-resources-reconcile";

describe("private resource visibility migration", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [{ _id: "mcp-personal", owner_subject: "user-sub" }, "private"],
    [{ _id: "mcp-team", owner_subject: "user-sub", owner_team_slug: "primary" }, "team"],
    [{ _id: "mcp-config", config_driven: true }, "global"],
    [{ _id: "mcp-discovered", agentgateway_discovered: true }, "global"],
    [{ _id: "mcp-service", owner_subject: "service-sub", owner_subject_kind: "service_account" }, "team"],
  ] as const)("classifies legacy MCP scope %#", (doc, expected) => {
    expect(classifyLegacyMcpVisibility(doc)).toBe(expected);
  });

  it("requires manual classification when a mutable MCP has no stable owner", () => {
    expect(classifyLegacyMcpVisibility({ _id: "mcp-orphan" })).toBeNull();
  });

  it.each([
    [{ id: "private-secret", owner: { type: "user", id: "user-sub" }, sharedWithTeams: [] }, "private"],
    [{ id: "shared-secret", owner: { type: "user", id: "user-sub" }, sharedWithTeams: ["primary"] }, "team"],
    [{ id: "team-secret", owner: { type: "team", id: "primary" }, sharedWithTeams: [] }, "team"],
  ] as const)("classifies legacy secret scope %#", (doc, expected) => {
    expect(classifyLegacySecretVisibility(doc)).toBe(expected);
  });

  it("plans private, team-shared, global platform, and unresolved rows without mutating them", () => {
    const plan = derivePrivateResourceVisibilityPlan({
      mcpServers: [
        { _id: "mcp-private", owner_subject: "user-sub" },
        { _id: "mcp-shared", owner_subject: "user-sub", owner_team_slug: "primary" },
        { _id: "mcp-platform", agentgateway_discovered: true },
        { _id: "mcp-orphan" },
      ],
      secrets: [
        { id: "secret-private", owner: { type: "user", id: "user-sub" }, sharedWithTeams: [] },
        { id: "secret-shared", owner: { type: "user", id: "user-sub" }, sharedWithTeams: ["secondary"] },
      ],
    });

    expect(plan.mcp_updates).toEqual([
      { id: "mcp-private", visibility: "private" },
      { id: "mcp-shared", visibility: "team" },
      { id: "mcp-platform", visibility: "global" },
    ]);
    expect(plan.secret_updates).toEqual([
      { id: "secret-private", visibility: "private" },
      { id: "secret-shared", visibility: "team" },
    ]);
    expect(plan.counts.unresolved_mcp_servers).toBe(1);
    expect(plan.warnings[0]).toContain("mcp-orphan");
  });

  it("reconciles through CAS before persisting private and team classifications", async () => {
    const mcpUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const secretUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const mcpServers = [
      { _id: "mcp-private", owner_subject: "private-owner" },
      {
        _id: "mcp-team",
        owner_subject: "legacy-owner",
        owner_team_slug: "primary",
        shared_with_teams: ["secondary"],
      },
      { _id: "mcp-platform", agentgateway_discovered: true },
    ];
    const secrets = [
      { id: "secret-private", owner: { type: "user" as const, id: "private-owner" } },
    ];
    jest.mocked(getCollection).mockImplementation(async (name: string) => {
      if (name === "mcp_servers") {
        return {
          find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(mcpServers) }),
          updateOne: mcpUpdateOne,
        } as never;
      }
      return {
        find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(secrets) }),
        updateOne: secretUpdateOne,
      } as never;
    });
    jest.mocked(reconcileMcpServerRelationships).mockResolvedValue({} as never);
    jest.mocked(reconcileConfigDrivenMcpServerRelationships).mockResolvedValue({} as never);
    jest.mocked(reconcileSecretRefOwnerRelationships).mockResolvedValue({} as never);

    const result = await applyPrivateResourceVisibilityMigration({
      actor: "test-admin",
      now: "2026-08-13T00:00:00.000Z",
    });

    expect(reconcileMcpServerRelationships).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        serverId: "mcp-team",
        ownerSubject: "legacy-owner",
        ownerTeamSlug: "primary",
        personalOwnerAccess: false,
        previousPersonalOwnerAccess: true,
        nextSharedTeamSlugs: ["secondary"],
      }),
      expect.objectContaining({ source: "private_resource_visibility_migration" }),
    );
    expect(mcpUpdateOne).toHaveBeenCalledWith(
      { _id: "mcp-team" },
      {
        $set: { visibility: "team" },
        $unset: { owner_subject: "", owner_subject_kind: "" },
      },
    );
    expect(reconcileSecretRefOwnerRelationships).toHaveBeenCalledWith({
      secretId: "secret-private",
      owner: { type: "user", id: "private-owner" },
      ownerSubject: "private-owner",
    });
    expect(reconcileConfigDrivenMcpServerRelationships).toHaveBeenCalledWith({
      serverId: "mcp-platform",
    });
    expect(mcpUpdateOne).toHaveBeenCalledWith(
      { _id: "mcp-platform" },
      {
        $set: { visibility: "global", shared_with_teams: [] },
        $unset: { owner_subject: "", owner_subject_kind: "", owner_team_slug: "" },
      },
    );
    expect(result.applied_counts).toEqual({ mcp_servers_updated: 3, secrets_updated: 1 });
  });
});
