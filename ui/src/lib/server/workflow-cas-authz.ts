// assisted-by claude code claude-opus-4-8
//
// Workflow PEP (Policy Enforcement Point) backed by the Centralized
// Authorization Service. This is the FIRST surface migrated onto CAS — it
// replaces the workflow-runs route's direct `requireResourcePermission` /
// `filterResourcesByPermission` calls (which leaked `task#read` / `pdp_denied`
// in error bodies) with CAS `authorize` / `authorizeMany`.
//
// Behavior preserved from the legacy path:
//   - org-admin bypass (mirrors `{ bypassForOrgAdmin: true }`)
//   - service_account vs user subject namespacing
//   - 401 on missing subject, 403 on deny
// What improves: clean reason codes (no OpenFGA vocabulary in responses) and
// one shared decision core + cache + audit.

import { ApiError } from "@/lib/api-error";
import { authorize, authorizeMany, type DecisionContext, type Subject } from "@/lib/authz";

const ORG_KEY = process.env.CAIPE_ORG_KEY ?? "caipe";

/** Workflow configs are modeled as the `task` resource type in OpenFGA. */
type WorkflowAction = "read" | "write" | "delete";

/** Structural subset of the session needed to resolve a subject. */
export interface WorkflowAuthzSession {
  sub?: string;
  isServiceAccount?: boolean;
  org?: string;
}

function subjectFromSession(session: WorkflowAuthzSession): Subject | null {
  const sub = typeof session.sub === "string" ? session.sub.trim() : "";
  if (!sub) return null;
  return { type: session.isServiceAccount === true ? "service_account" : "user", id: sub };
}

function ctxFromSession(session: WorkflowAuthzSession): DecisionContext {
  return { tenantId: typeof session.org === "string" && session.org.trim() ? session.org.trim() : undefined };
}

async function isOrgAdmin(subject: Subject, ctx: DecisionContext): Promise<boolean> {
  const r = await authorize(
    { subject, resource: { type: "organization", id: ORG_KEY }, action: "manage" },
    ctx,
  );
  return r.decision === "ALLOW";
}

/**
 * Boolean access check for a single workflow config. Org admins are allowed
 * unconditionally. Returns false (never throws) for missing subject or deny —
 * matching the legacy `userCanAccessConfig` try/catch idiom.
 */
export async function workflowAccessAllowed(
  session: WorkflowAuthzSession,
  configId: string,
  action: WorkflowAction,
): Promise<boolean> {
  const subject = subjectFromSession(session);
  if (!subject) return false;
  const ctx = ctxFromSession(session);
  if (await isOrgAdmin(subject, ctx)) return true;
  const r = await authorize({ subject, resource: { type: "task", id: configId }, action }, ctx);
  return r.decision === "ALLOW";
}

/**
 * Throwing access check. 401 on missing subject, 403 on deny — with clean
 * reason codes (no OpenFGA relation strings leaked).
 */
export async function requireWorkflowAccess(
  session: WorkflowAuthzSession,
  configId: string,
  action: WorkflowAction,
): Promise<void> {
  const subject = subjectFromSession(session);
  if (!subject) {
    throw new ApiError(
      "A stable user subject is required for this workflow authorization check.",
      401,
      "NO_SUBJECT",
      "session_expired",
      "sign_in",
    );
  }
  if (!(await workflowAccessAllowed(session, configId, action))) {
    throw new ApiError(
      "You do not have permission to access this workflow.",
      403,
      "WORKFLOW_FORBIDDEN",
      "forbidden",
      "contact_admin",
    );
  }
}

/**
 * Filters a list of workflow configs to those the subject may access.
 * Org admins see all. Uses one batched CAS call for the rest.
 */
export async function filterAccessibleWorkflowConfigs<T>(
  session: WorkflowAuthzSession,
  configs: T[],
  getId: (config: T) => string,
  action: WorkflowAction = "read",
): Promise<T[]> {
  const subject = subjectFromSession(session);
  if (!subject) return [];
  if (configs.length === 0) return [];
  const ctx = ctxFromSession(session);
  if (await isOrgAdmin(subject, ctx)) return configs;

  const ids = configs.map(getId);
  const results = await authorizeMany(subject, action, "task", ids, ctx);
  return configs.filter((config) => results.get(getId(config))?.decision === "ALLOW");
}
