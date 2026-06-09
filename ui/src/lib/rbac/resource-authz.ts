import { ApiError } from "@/lib/api-error";
import type { UniversalRebacResourceType } from "@/types/rbac-universal";

import { checkOpenFgaTuple,type OpenFgaCheckResult,type OpenFgaTupleKey } from "./openfga";
import { openFgaResourceObject } from "./openfga-resource-ids";
import { organizationObjectId } from "./organization";

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
  /**
   * Set by the Bearer-auth path for OAuth2 client-credentials tokens
   * (Keycloak service accounts, e.g. the Slack bot). When true the subject
   * is graphed as `service_account:<sub>` instead of `user:<sub>` so it
   * matches the relationships those callers are granted in OpenFGA.
   */
  isServiceAccount?: boolean;
}

export interface ResourcePermissionOptions {
  check?: (tuple: OpenFgaTupleKey) => Promise<OpenFgaCheckResult>;
  /**
   * When true, the resource-permission helpers short-circuit to allow if the
   * caller holds `user:<sub> can_manage organization:<caipeOrgKey>` in OpenFGA.
   *
   * This is the documented super-grant for org admins on the KB / Search /
   * Data Sources / Graph / MCP Tools surfaces. It is OFF by default; call
   * sites must explicitly opt in so the bypass is auditable in code review.
   *
   * Set the env var `RAG_ADMIN_BYPASS_DISABLED=true` to force the bypass off
   * everywhere as a kill switch (the helper falls back to pure per-resource
   * OpenFGA checks).
   */
  bypassForOrgAdmin?: boolean;
}

function isOrgAdminBypassKillSwitchEnabled(): boolean {
  const raw = process.env.RAG_ADMIN_BYPASS_DISABLED;
  if (!raw) return false;
  return raw === "1" || raw.trim().toLowerCase() === "true";
}

async function isOrgAdmin(
  subject: string,
  check: (tuple: OpenFgaTupleKey) => Promise<OpenFgaCheckResult>,
): Promise<boolean> {
  if (isOrgAdminBypassKillSwitchEnabled()) return false;
  try {
    const result = await check({
      user: subject,
      relation: "can_manage",
      object: organizationObjectId(),
    });
    return result.allowed === true;
  } catch {
    return false;
  }
}

/**
 * Authorize an ownership transfer (spec 2026-06-03, US3 / contract R3). The
 * caller may transfer a shareable resource only if they can manage it
 * (current owner-team admin — `<type>:<id>#can_manage`) OR they are an org
 * admin. Returns true/false rather than throwing so callers can shape their
 * own error. Reuses the same `check` injection as `requireResourcePermission`
 * for testability.
 */
export async function canTransferResourceOwnership(
  session: ResourceAuthzSession,
  target: { type: UniversalRebacResourceType; id: string },
  options: ResourcePermissionOptions = {},
): Promise<boolean> {
  const subject = subjectFromSession(session);
  if (!subject) return false;
  const check = options.check ?? checkOpenFgaTuple;
  if (await isOrgAdmin(subject, check)) return true;
  try {
    const result = await check({
      user: subject,
      relation: "can_manage",
      object: resourceObject(target.type, target.id),
    });
    return result.allowed === true;
  } catch {
    return false;
  }
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
  if (typeof session.sub !== "string" || !session.sub.trim()) return null;
  const sub = session.sub.trim();
  // Service-account (client-credentials) callers are graphed under the
  // `service_account:` namespace, matching the OpenFGA relationships seeded
  // for first-party services (e.g. the Slack bot's read grant on
  // `system_config:platform_settings`). Interactive users stay `user:`.
  return session.isServiceAccount === true ? `service_account:${sub}` : `user:${sub}`;
}

/**
 * Per-skill OpenFGA gate for workspace routes. Org admins and holders of
 * `admin_surface:skills#can_manage` (bootstrap grant for app admins) may
 * mutate any skill without a per-resource owner tuple; everyone else is
 * checked against `skill:<id>#can_*`.
 */
export async function requireSkillPermission(
  session: ResourceAuthzSession,
  skillId: string,
  action: ResourcePermissionAction,
  options: ResourcePermissionOptions = {},
): Promise<void> {
  const subject = subjectFromSession(session);
  if (!subject) {
    throw new ApiError(
      "A stable user subject is required for this resource authorization check.",
      401,
      "NO_SUBJECT",
      "session_expired",
      "sign_in",
    );
  }

  const check = options.check ?? checkOpenFgaTuple;

  if (!isOrgAdminBypassKillSwitchEnabled() && (await isOrgAdmin(subject, check))) {
    return;
  }

  if (session.role === "admin") {
    try {
      const surface = await check({
        user: subject,
        relation: "can_manage",
        object: "admin_surface:skills",
      });
      if (surface.allowed === true) {
        return;
      }
    } catch {
      // Fall through to per-skill check.
    }
  }

  await requireResourcePermission(session, { type: "skill", id: skillId, action }, options);
}

/**
 * Per-agent OpenFGA gate for Dynamic Agent routes. Organization admins
 * (including Super Admins team members with `organization#admin`) may
 * read, write, manage, or delete any agent without a per-resource tuple;
 * everyone else is checked against `agent:<id>#can_*`.
 */
export async function requireAgentPermission(
  session: ResourceAuthzSession,
  agentId: string,
  action: ResourcePermissionAction,
  options: ResourcePermissionOptions = {},
): Promise<void> {
  const subject = subjectFromSession(session);
  if (!subject) {
    throw new ApiError(
      "A stable user subject is required for this resource authorization check.",
      401,
      "NO_SUBJECT",
      "session_expired",
      "sign_in",
    );
  }

  const check = options.check ?? checkOpenFgaTuple;

  if (!isOrgAdminBypassKillSwitchEnabled() && (await isOrgAdmin(subject, check))) {
    return;
  }

  await requireResourcePermission(session, { type: "agent", id: agentId, action }, options);
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

  const check = options.check ?? checkOpenFgaTuple;

  if (options.bypassForOrgAdmin && (await isOrgAdmin(subject, check))) {
    return;
  }

  const tuple: OpenFgaTupleKey = {
    user: subject,
    relation: openFgaRelationForResourceAction(target.action),
    object: resourceObject(target.type, target.id),
  };
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

  if (options.bypassForOrgAdmin && (await isOrgAdmin(subject, check))) {
    return [...resources];
  }

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
