/**
 * Tome audit emission.
 *
 * Every mutating Tome action (project lifecycle, source attach/detach, ingest
 * runs, wiki page writes/deletes, Talk posts) emits a structured event into the
 * shared CAIPE audit pipeline via `getAuditBackend().write()`, so Tome activity
 * shows up in the same audit views as the rest of the platform.
 *
 * Shape mirrors the credential audit writer (`@/lib/credentials/audit`): a
 * free-form dotted `action`, explicit `actor`/`resource`, hashed subject.
 *
 * Fire-and-forget: `write()` never throws, and the whole emit is wrapped so a
 * malformed event can never break the action it describes. Callers emit AFTER
 * the mutation succeeds and never `await` (there is nothing to await).
 */

import { createHash, randomUUID } from "crypto";
import { getAuditBackend } from "@/lib/audit";

export type TomeAuditOutcome = "success" | "error" | "deny";

/** Who performed the action. `user` = human (session/bearer), `agent` = the
 * ingest/chat agent via its shared token, `service` = a first-party service
 * account. `id` is the subject used for the hashed identity (OIDC sub or
 * email). */
export interface TomeAuditActor {
  type: "user" | "agent" | "service";
  id: string;
  email?: string;
}

export interface TomeAuditInput {
  /** Dotted action, e.g. `tome.project.create`, `tome.page.edit`. */
  action: string;
  actor: TomeAuditActor;
  /** Project slug the action targets. */
  projectSlug: string;
  /** Wiki-relative page path, when the action targets a page. */
  page?: string;
  /** Defaults to `success`; callers emit after the mutation lands. */
  outcome?: TomeAuditOutcome;
  tenantId?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

const SUBJECT_SALT = process.env.AUDIT_SUBJECT_SALT ?? "caipe-098-audit";

function hashSubject(id: string): string {
  return "sha256:" + createHash("sha256").update(`${SUBJECT_SALT}:${id}`).digest("hex");
}

/** Derive a Tome audit actor from a `getAuthFromBearerOrSession` result.
 * Prefers the OIDC subject; falls back to email. Service-account bearer
 * callers (e.g. the Slack bot) are tagged `service`. */
export function tomeActorFromAuth(auth: {
  user?: { email?: string };
  session?: unknown;
}): TomeAuditActor {
  const session = (auth.session ?? {}) as {
    sub?: string;
    isServiceAccount?: boolean;
  };
  const email = auth.user?.email;
  const id = session.sub || email || "unknown";
  return {
    type: session.isServiceAccount ? "service" : "user",
    id,
    email,
  };
}

/** The agent actor for internal agent-callback routes (shared agent token; no
 * human identity). `author` is the free-form author the callback carries. */
export function tomeAgentActor(author?: string): TomeAuditActor {
  const id = author?.trim() || "tome-agent";
  return { type: "agent", id };
}

/**
 * Emit one Tome audit event. Never throws; safe to call inline after a
 * successful mutation without awaiting.
 */
export function auditTome(input: TomeAuditInput): void {
  try {
    const resourceRef = input.page
      ? `page:${input.projectSlug}/${input.page}`
      : `project:${input.projectSlug}`;
    getAuditBackend().write({
      audit_event_id: randomUUID(),
      type: "tome_action",
      ts: new Date().toISOString(),
      action: input.action,
      component: "tome",
      source: input.actor.type === "agent" ? "agent_callback" : "webui_backend",
      tenant_id: input.tenantId ?? process.env.TENANT_ID ?? "default",
      subject_hash: hashSubject(input.actor.id),
      outcome: input.outcome ?? "success",
      correlation_id: input.correlationId ?? randomUUID(),
      resource_ref: resourceRef,
      resource_type: input.page ? "page" : "project",
      resource_id: input.page ? `${input.projectSlug}/${input.page}` : input.projectSlug,
      actor: input.actor,
      ...(input.actor.email ? { user_email: input.actor.email } : {}),
      ...(input.metadata ? { details: input.metadata } : {}),
    });
  } catch (err) {
    // Audit must never break the action it describes.
    console.warn("[tome-audit] failed to emit audit event", err);
  }
}
