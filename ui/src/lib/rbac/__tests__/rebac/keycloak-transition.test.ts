import {
  classifyRealmRole,
  curateRealmRolesForUser,
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

  it("curates user-list roles while retaining raw roles for debugging", () => {
    expect(
      curateRealmRolesForUser([
        "admin",
        "chat_user",
        "offline_access",
        "default-roles-caipe",
        "team_member:manual-u2-1778604473704-qjkzq",
        "agent_admin:1-april-2025",
        "custom_support_role",
      ])
    ).toMatchObject({
      roles: ["admin", "chat_user", "custom_support_role"],
      raw_roles: [
        "admin",
        "chat_user",
        "offline_access",
        "default-roles-caipe",
        "team_member:manual-u2-1778604473704-qjkzq",
        "agent_admin:1-april-2025",
        "custom_support_role",
      ],
      hidden_role_count: 4,
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
