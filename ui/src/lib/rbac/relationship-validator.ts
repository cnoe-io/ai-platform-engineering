import type {
  UniversalRebacRelationship,
  UniversalRebacResourceType,
} from "@/types/rbac-universal";

import { getResourceTypeDefinition, isSupportedResourceAction } from "./resource-model";

export type RelationshipValidationErrorCode =
  | "missing_subject"
  | "missing_resource"
  | "unsupported_action";

export type RelationshipValidationResult =
  | { valid: true }
  | {
      valid: false;
      code: RelationshipValidationErrorCode;
      reason: string;
    };

function missingRef(type: "subject" | "resource"): RelationshipValidationResult {
  return {
    valid: false,
    code: type === "subject" ? "missing_subject" : "missing_resource",
    reason: `Relationship ${type} must include a non-empty id`,
  };
}

export function validateRelationship(
  relationship: UniversalRebacRelationship
): RelationshipValidationResult {
  if (!relationship.subject.id.trim()) {
    return missingRef("subject");
  }
  if (!relationship.resource.id.trim()) {
    return missingRef("resource");
  }
  if (!isSupportedResourceAction(relationship.resource.type, relationship.action)) {
    return {
      valid: false,
      code: "unsupported_action",
      reason: `Resource type ${relationship.resource.type} does not support action ${relationship.action}`,
    };
  }
  return { valid: true };
}

export function assertRelationshipValid(relationship: UniversalRebacRelationship): void {
  const result = validateRelationship(relationship);
  if (result.valid === false) {
    throw new Error(result.reason);
  }
}

export function isUniversalRebacResourceType(value: string): value is UniversalRebacResourceType {
  return Boolean(getResourceTypeDefinition(value as UniversalRebacResourceType));
}
