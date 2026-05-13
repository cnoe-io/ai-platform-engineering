import { classifyRealmRole, isRoleSupersededByRebac } from "./keycloak-transition";
import type { RebacEnforcementStatusRecord } from "./enforcement-status";
import type { UniversalRebacResourceType } from "@/types/rbac-universal";

export interface RealmRoleDriftFinding {
  subject: string;
  role: string;
  resource_type?: UniversalRebacResourceType;
  resource_id?: string;
  severity: "info" | "warning" | "critical";
  finding_type: "superseded_realm_role";
}

export function detectRealmRoleDrift(input: {
  subject: string;
  roles: string[];
  enforcementStatuses: Pick<RebacEnforcementStatusRecord, "resource_type" | "enforcement_status">[];
}): RealmRoleDriftFinding[] {
  return input.roles
    .filter((role) => isRoleSupersededByRebac(role, input.enforcementStatuses))
    .map((role) => {
      const classification = classifyRealmRole(role);
      return {
        subject: input.subject,
        role,
        resource_type: classification.resource_type,
        resource_id: classification.resource_id,
        severity: "warning",
        finding_type: "superseded_realm_role",
      };
    });
}
