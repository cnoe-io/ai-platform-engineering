import { detectRealmRoleDrift } from "../../drift-detection";

describe("realm role drift detection", () => {
  it("reports transitional resource roles that remain after ReBAC enforcement", () => {
    expect(
      detectRealmRoleDrift({
        subject: "alice@example.com",
        roles: ["agent_user:incident-agent", "chat_user"],
        enforcementStatuses: [
          { resource_type: "agent", enforcement_status: "rebac_enforced" },
        ],
      })
    ).toEqual([
      {
        subject: "alice@example.com",
        role: "agent_user:incident-agent",
        resource_type: "agent",
        resource_id: "incident-agent",
        severity: "warning",
        finding_type: "superseded_realm_role",
      },
    ]);
  });
});
