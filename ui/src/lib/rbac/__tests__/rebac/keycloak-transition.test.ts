import {
  classifyRealmRole,
  filterRolesForRebacEnforcement,
  legacyRoleAllows,
} from "../../keycloak-transition";

describe("Keycloak ReBAC transition helpers", () => {
  it("classifies bootstrap, team, and resource-specific realm roles", () => {
    expect(classifyRealmRole("admin_user")).toMatchObject({
      kind: "bootstrap",
      transition_state: "permanent",
    });
    expect(classifyRealmRole("team_member:platform")).toMatchObject({
      kind: "team",
      transition_state: "transitional",
      resource_type: "team",
      resource_id: "platform",
      action: "read",
    });
    expect(classifyRealmRole("agent_user:incident-agent")).toMatchObject({
      kind: "resource",
      transition_state: "transitional",
      resource_type: "agent",
      resource_id: "incident-agent",
      action: "use",
    });
  });

  it("stops treating stale resource roles as allow when the resource type is ReBAC-enforced", () => {
    const statuses = [{ resource_type: "agent" as const, enforcement_status: "rebac_enforced" as const }];

    expect(
      legacyRoleAllows({
        roles: ["agent_user:incident-agent"],
        resource: { type: "agent", id: "incident-agent" },
        action: "use",
        enforcementStatuses: statuses,
      })
    ).toEqual({
      allowed: false,
      matched_roles: [],
      ignored_roles: ["agent_user:incident-agent"],
    });
  });

  it("filters permanent per-resource role sync for ReBAC-enforced resource types", () => {
    const statuses = [
      { resource_type: "agent" as const, enforcement_status: "rebac_enforced" as const },
      { resource_type: "tool" as const, enforcement_status: "role_gated" as const },
    ];

    expect(
      filterRolesForRebacEnforcement(
        ["agent_user:incident-agent", "tool_user:jira_*", "admin_user"],
        statuses
      )
    ).toEqual({
      active_roles: ["tool_user:jira_*", "admin_user"],
      skipped_roles: ["agent_user:incident-agent"],
    });
  });
});
