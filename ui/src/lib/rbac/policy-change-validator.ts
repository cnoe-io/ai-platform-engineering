import type { UniversalRebacRelationship } from "@/types/rbac-universal";

import { validateRelationship } from "./relationship-validator";

export type PolicyChangeOperation = "grant" | "revoke";

export type PolicyChangeValidationCode =
  | "unsupported_action"
  | "missing_subject"
  | "missing_resource"
  | "privilege_escalation"
  | "circular_grant"
  | "last_admin_risk";

export interface PolicyChangeActor {
  email: string;
  platformAdmin: boolean;
  managedResources?: string[];
}

export interface PolicyChangeValidationInput {
  writes: UniversalRebacRelationship[];
  deletes: UniversalRebacRelationship[];
  actor: PolicyChangeActor;
  existingAdminRelationships?: number;
}

export interface BlockedPolicyChange {
  operation: PolicyChangeOperation;
  relationship: UniversalRebacRelationship;
  code: PolicyChangeValidationCode;
  reason: string;
}

export interface PolicyChangeValidationResult {
  valid: boolean;
  grants: UniversalRebacRelationship[];
  revocations: UniversalRebacRelationship[];
  blocked: BlockedPolicyChange[];
}

const SENSITIVE_RESOURCE_TYPES = new Set(["admin_surface", "audit_log", "policy", "secret_ref", "system_config"]);
const DELEGATED_HIGH_RISK_ACTIONS = new Set(["administer", "approve", "audit", "manage"]);

function resourceKey(relationship: UniversalRebacRelationship): string {
  return `${relationship.resource.type}:${relationship.resource.id}`;
}

function isDelegatedScopeViolation(
  relationship: UniversalRebacRelationship,
  actor: PolicyChangeActor
): boolean {
  if (actor.platformAdmin) return false;
  if (SENSITIVE_RESOURCE_TYPES.has(relationship.resource.type)) return true;
  if (!DELEGATED_HIGH_RISK_ACTIONS.has(relationship.action)) return false;
  return !(actor.managedResources ?? []).includes(resourceKey(relationship));
}

function isCircularGrant(relationship: UniversalRebacRelationship): boolean {
  return (
    relationship.subject.type === relationship.resource.type &&
    relationship.subject.id === relationship.resource.id
  );
}

function isLastAdminRisk(
  relationship: UniversalRebacRelationship,
  input: PolicyChangeValidationInput
): boolean {
  if ((input.existingAdminRelationships ?? 2) > 1) return false;
  if (!["manage", "administer"].includes(relationship.action)) return false;
  return relationship.subject.relation === "admin" || relationship.subject.relation === "owner";
}

function validateOne(
  operation: PolicyChangeOperation,
  relationship: UniversalRebacRelationship,
  input: PolicyChangeValidationInput
): BlockedPolicyChange | null {
  const base = validateRelationship(relationship);
  if (base.valid === false) {
    return {
      operation,
      relationship,
      code: base.code,
      reason: base.reason,
    };
  }

  if (operation === "grant" && isCircularGrant(relationship)) {
    return {
      operation,
      relationship,
      code: "circular_grant",
      reason: "A resource cannot grant access to itself",
    };
  }

  if (operation === "grant" && isDelegatedScopeViolation(relationship, input.actor)) {
    return {
      operation,
      relationship,
      code: "privilege_escalation",
      reason: "Delegated administrators cannot grant privileged relationships outside their scope",
    };
  }

  if (operation === "revoke" && isLastAdminRisk(relationship, input)) {
    return {
      operation,
      relationship,
      code: "last_admin_risk",
      reason: "This revocation may remove the last administrator for the resource",
    };
  }

  return null;
}

export function validatePolicyChangeSet(
  input: PolicyChangeValidationInput
): PolicyChangeValidationResult {
  const blocked: BlockedPolicyChange[] = [];
  const grants: UniversalRebacRelationship[] = [];
  const revocations: UniversalRebacRelationship[] = [];

  for (const relationship of input.writes) {
    const error = validateOne("grant", relationship, input);
    if (error) blocked.push(error);
    else grants.push(relationship);
  }

  for (const relationship of input.deletes) {
    const error = validateOne("revoke", relationship, input);
    if (error) blocked.push(error);
    else revocations.push(relationship);
  }

  return {
    valid: blocked.length === 0,
    grants,
    revocations,
    blocked,
  };
}
