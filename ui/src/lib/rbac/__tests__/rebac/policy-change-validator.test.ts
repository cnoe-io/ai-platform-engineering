import type { UniversalRebacRelationship } from "@/types/rbac-universal";

import { validatePolicyChangeSet } from "../../policy-change-validator";

function relationship(
  overrides: Partial<UniversalRebacRelationship> = {}
): UniversalRebacRelationship {
  return {
    subject: { type: "team", id: "platform", relation: "member" },
    action: "use",
    resource: { type: "agent", id: "incident-agent" },
    ...overrides,
  };
}

describe("validatePolicyChangeSet", () => {
  it("accepts supported grants and revocations for a platform administrator", () => {
    const result = validatePolicyChangeSet({
      writes: [relationship()],
      deletes: [relationship({ action: "read", resource: { type: "knowledge_base", id: "kb-1" } })],
      actor: { email: "admin@example.com", platformAdmin: true },
    });

    expect(result.valid).toBe(true);
    expect(result.grants).toHaveLength(1);
    expect(result.revocations).toHaveLength(1);
    expect(result.blocked).toHaveLength(0);
  });

  it("blocks unsupported actions before a change set can be applied", () => {
    const result = validatePolicyChangeSet({
      writes: [relationship({ action: "ingest", resource: { type: "agent", id: "agent-1" } })],
      deletes: [],
      actor: { email: "admin@example.com", platformAdmin: true },
    });

    expect(result.valid).toBe(false);
    expect(result.blocked[0]).toMatchObject({
      operation: "grant",
      code: "unsupported_action",
    });
  });

  it("blocks privileged grants for delegated administrators outside their scope", () => {
    const result = validatePolicyChangeSet({
      writes: [
        relationship({
          subject: { type: "team", id: "platform", relation: "admin" },
          action: "manage",
          resource: { type: "system_config", id: "global" },
        }),
      ],
      deletes: [],
      actor: { email: "team-admin@example.com", platformAdmin: false },
    });

    expect(result.valid).toBe(false);
    expect(result.blocked[0]).toMatchObject({
      operation: "grant",
      code: "privilege_escalation",
    });
  });

  it("warns on revocations that may remove the last administrator", () => {
    const result = validatePolicyChangeSet({
      writes: [],
      deletes: [
        relationship({
          subject: { type: "team", id: "platform", relation: "admin" },
          action: "manage",
          resource: { type: "team", id: "platform" },
        }),
      ],
      actor: { email: "admin@example.com", platformAdmin: true },
      existingAdminRelationships: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.blocked[0]).toMatchObject({
      operation: "revoke",
      code: "last_admin_risk",
    });
  });
});
