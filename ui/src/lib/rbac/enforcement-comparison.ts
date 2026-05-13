import { checkUniversalRebacRelationship } from "./openfga";
import { legacyRoleAllows } from "./keycloak-transition";
import type { RebacEnforcementStatusRecord } from "./enforcement-status";
import type {
  UniversalRebacRelationship,
  UniversalRebacResourceAction,
  UniversalRebacResourceRef,
  UniversalRebacSubjectRef,
} from "@/types/rbac-universal";

export interface EnforcementComparisonInput {
  subject: UniversalRebacSubjectRef;
  resource: UniversalRebacResourceRef;
  action: UniversalRebacResourceAction;
  realm_roles: string[];
  enforcementStatuses: RebacEnforcementStatusRecord[];
}

export async function compareRoleAndRebacEnforcement(input: EnforcementComparisonInput) {
  const relationship: UniversalRebacRelationship = {
    subject: input.subject,
    action: input.action,
    resource: input.resource,
  };
  const status =
    input.enforcementStatuses.find((row) => row.resource_type === input.resource.type)
      ?.enforcement_status ?? "role_gated";

  const legacy = legacyRoleAllows({
    roles: input.realm_roles,
    resource: input.resource,
    action: input.action,
    enforcementStatuses: input.enforcementStatuses,
  });
  const rebac = await checkUniversalRebacRelationship(relationship);

  const effectiveSource = status === "rebac_enforced" ? "rebac" : legacy.allowed ? "legacy_role" : "rebac";
  const effectiveAllowed = effectiveSource === "legacy_role" ? legacy.allowed : Boolean(rebac.allowed);

  return {
    subject: input.subject,
    resource: input.resource,
    action: input.action,
    enforcement_status: status,
    legacy,
    rebac: { allowed: Boolean(rebac.allowed) },
    effective: {
      allowed: effectiveAllowed,
      source: effectiveSource,
    },
  };
}
