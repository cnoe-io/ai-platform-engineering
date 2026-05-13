import type { RebacEnforcementStatusRecord } from "./enforcement-status";
import type {
  UniversalRebacResourceAction,
  UniversalRebacResourceRef,
  UniversalRebacResourceType,
} from "@/types/rbac-universal";

export type RealmRoleKind = "bootstrap" | "system" | "team" | "resource" | "unknown";
export type RealmRoleTransitionState = "permanent" | "system" | "transitional";

export interface RealmRoleClassification {
  role: string;
  kind: RealmRoleKind;
  transition_state: RealmRoleTransitionState;
  resource_type?: UniversalRebacResourceType;
  resource_id?: string;
  action?: UniversalRebacResourceAction;
}

export interface LegacyRoleAllowsInput {
  roles: string[];
  resource: UniversalRebacResourceRef;
  action: UniversalRebacResourceAction;
  enforcementStatuses?: Pick<RebacEnforcementStatusRecord, "resource_type" | "enforcement_status">[];
}

const SYSTEM_ROLES = new Set(["default-roles-caipe", "offline_access", "uma_authorization"]);
const BOOTSTRAP_ROLES = new Set([
  "admin",
  "admin_user",
  "chat_user",
  "kb_admin",
  "kb_ingestor",
  "tool_user:*",
]);

const ROLE_PATTERNS: Array<{
  prefix: string;
  kind: RealmRoleKind;
  resource_type: UniversalRebacResourceType;
  action: UniversalRebacResourceAction;
}> = [
  { prefix: "team_member:", kind: "team", resource_type: "team", action: "read" },
  { prefix: "team_admin:", kind: "team", resource_type: "team", action: "manage" },
  { prefix: "agent_user:", kind: "resource", resource_type: "agent", action: "use" },
  { prefix: "agent_admin:", kind: "resource", resource_type: "agent", action: "manage" },
  { prefix: "tool_user:", kind: "resource", resource_type: "tool", action: "call" },
  { prefix: "kb_reader:", kind: "resource", resource_type: "knowledge_base", action: "read" },
  { prefix: "kb_ingestor:", kind: "resource", resource_type: "knowledge_base", action: "ingest" },
  { prefix: "kb_admin:", kind: "resource", resource_type: "knowledge_base", action: "administer" },
  { prefix: "task_user:", kind: "resource", resource_type: "task", action: "use" },
  { prefix: "task_admin:", kind: "resource", resource_type: "task", action: "manage" },
  { prefix: "skill_user:", kind: "resource", resource_type: "skill", action: "use" },
  { prefix: "skill_admin:", kind: "resource", resource_type: "skill", action: "manage" },
];

function statusByType(
  statuses: Pick<RebacEnforcementStatusRecord, "resource_type" | "enforcement_status">[] = []
): Map<UniversalRebacResourceType, string> {
  return new Map(statuses.map((status) => [status.resource_type, status.enforcement_status]));
}

export function classifyRealmRole(role: string): RealmRoleClassification {
  if (SYSTEM_ROLES.has(role)) {
    return { role, kind: "system", transition_state: "system" };
  }
  if (BOOTSTRAP_ROLES.has(role)) {
    return { role, kind: "bootstrap", transition_state: "permanent" };
  }

  for (const pattern of ROLE_PATTERNS) {
    if (!role.startsWith(pattern.prefix)) continue;
    const resourceId = role.slice(pattern.prefix.length);
    return {
      role,
      kind: pattern.kind,
      transition_state: "transitional",
      resource_type: pattern.resource_type,
      resource_id: resourceId,
      action: pattern.action,
    };
  }

  return { role, kind: "unknown", transition_state: "transitional" };
}

export function isRoleSupersededByRebac(
  role: string,
  statuses: Pick<RebacEnforcementStatusRecord, "resource_type" | "enforcement_status">[] = []
): boolean {
  const classification = classifyRealmRole(role);
  if (!classification.resource_type) return false;
  return statusByType(statuses).get(classification.resource_type) === "rebac_enforced";
}

export function filterRolesForRebacEnforcement(
  roles: string[],
  statuses: Pick<RebacEnforcementStatusRecord, "resource_type" | "enforcement_status">[] = []
): { active_roles: string[]; skipped_roles: string[] } {
  const active_roles: string[] = [];
  const skipped_roles: string[] = [];
  for (const role of roles) {
    if (isRoleSupersededByRebac(role, statuses)) {
      skipped_roles.push(role);
    } else {
      active_roles.push(role);
    }
  }
  return { active_roles, skipped_roles };
}

function roleMatchesResource(
  classification: RealmRoleClassification,
  resource: UniversalRebacResourceRef,
  action: UniversalRebacResourceAction
): boolean {
  if (classification.resource_type !== resource.type) return false;
  if (classification.action !== action) return false;
  return classification.resource_id === "*" || classification.resource_id === resource.id;
}

export function legacyRoleAllows(input: LegacyRoleAllowsInput): {
  allowed: boolean;
  matched_roles: string[];
  ignored_roles: string[];
} {
  const matched_roles: string[] = [];
  const ignored_roles: string[] = [];

  for (const role of input.roles) {
    const classification = classifyRealmRole(role);
    if (!roleMatchesResource(classification, input.resource, input.action)) continue;
    if (isRoleSupersededByRebac(role, input.enforcementStatuses)) {
      ignored_roles.push(role);
    } else {
      matched_roles.push(role);
    }
  }

  return { allowed: matched_roles.length > 0, matched_roles, ignored_roles };
}
