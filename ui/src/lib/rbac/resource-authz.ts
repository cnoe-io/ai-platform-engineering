import { ApiError } from "@/lib/api-error";
import type { UniversalRebacResourceType } from "@/types/rbac-universal";

import { checkOpenFgaTuple, type OpenFgaCheckResult, type OpenFgaTupleKey } from "./openfga";
import { openFgaResourceObject } from "./openfga-resource-ids";

export type ResourcePermissionAction =
  | "list"
  | "discover"
  | "read"
  | "read-metadata"
  | "use"
  | "write"
  | "admin"
  | "manage"
  | "share"
  | "delete"
  | "ingest"
  | "call"
  | "invoke"
  | "audit";

export interface ResourcePermissionTarget {
  type: UniversalRebacResourceType;
  id: string;
  action: ResourcePermissionAction;
}

export interface ResourceAuthzSession {
  sub?: unknown;
  user?: { email?: string | null } | null;
  role?: string;
}

export interface ResourcePermissionOptions {
  check?: (tuple: OpenFgaTupleKey) => Promise<OpenFgaCheckResult>;
  /**
   * @deprecated OpenFGA is the PDP for resource checks. This option is retained
   * for source compatibility with older call sites but no longer bypasses checks.
   */
  allowAdminBypass?: boolean;
}

export function openFgaRelationForResourceAction(action: ResourcePermissionAction): string {
  switch (action) {
    case "list":
    case "discover":
      return "can_discover";
    case "read":
      return "can_read";
    case "read-metadata":
      return "can_read_metadata";
    case "use":
      return "can_use";
    case "write":
      return "can_write";
    case "admin":
    case "manage":
      return "can_manage";
    case "share":
      return "can_share";
    case "delete":
      return "can_delete";
    case "ingest":
      return "can_ingest";
    case "call":
      return "can_call";
    case "invoke":
      return "can_invoke";
    case "audit":
      return "can_audit";
  }
}

export function resourceObject(type: UniversalRebacResourceType, id: string): string {
  return openFgaResourceObject(type, id);
}

export function subjectFromSession(session: ResourceAuthzSession): string | null {
  return typeof session.sub === "string" && session.sub.trim()
    ? `user:${session.sub.trim()}`
    : null;
}

export async function requireResourcePermission(
  session: ResourceAuthzSession,
  target: ResourcePermissionTarget,
  options: ResourcePermissionOptions = {}
): Promise<void> {
  const subject = subjectFromSession(session);
  if (!subject) {
    throw new ApiError(
      "A stable user subject is required for this resource authorization check.",
      401,
      "NO_SUBJECT",
      "session_expired",
      "sign_in"
    );
  }

  const tuple: OpenFgaTupleKey = {
    user: subject,
    relation: openFgaRelationForResourceAction(target.action),
    object: resourceObject(target.type, target.id),
  };
  const check = options.check ?? checkOpenFgaTuple;
  const result = await check(tuple);
  if (!result.allowed) {
    throw new ApiError(
      "You do not have permission to access this resource.",
      403,
      `${target.type}#${target.action}`,
      "pdp_denied",
      "contact_admin"
    );
  }
}

export async function filterResourcesByPermission<T>(
  session: ResourceAuthzSession,
  resources: T[],
  target: {
    type: UniversalRebacResourceType;
    action: ResourcePermissionAction;
    id: (resource: T) => string;
  },
  options: ResourcePermissionOptions = {}
): Promise<T[]> {
  const subject = subjectFromSession(session);
  if (!subject) return [];

  const check = options.check ?? checkOpenFgaTuple;
  const decisions: Array<T | null> = await Promise.all(
    resources.map(async (resource) => {
      try {
        const result = await check({
          user: subject,
          relation: openFgaRelationForResourceAction(target.action),
          object: resourceObject(target.type, target.id(resource)),
        });
        return result.allowed ? resource : null;
      } catch {
        return null;
      }
    })
  );

  return decisions.filter((resource): resource is T => resource !== null);
}
