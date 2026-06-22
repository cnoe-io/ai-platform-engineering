import { NextResponse } from "next/server";

import { logOpenFgaRebacAuditEvent } from "./audit";
import { withAuthzSpan } from "./authz-tracing";
import { checkOpenFgaTuple } from "./openfga";
import { listUserTeamSlugs } from "./openfga-team-membership";

export interface AgentUsePermissionInput {
  subject?: string;
  agentId?: unknown;
  email?: string;
  tenantId?: string;
  correlationId?: string;
  traceparent?: string;
  /**
   * Whether the caller is a Keycloak service account (client-credentials).
   * When true the subject is graphed as `service_account:<sub>` rather than
   * `user:<sub>` (canonical detection rule, spec 2026-06-05-service-accounts
   * T002 — `preferred_username` starts `service-account-`). Service accounts
   * are authorized ONLY by their own direct grants: the email-principal and
   * team-union fallbacks (both human/user concepts) are skipped for them, so
   * an SA's effective agent access is exactly what was granted at create/scope
   * time (FR-020 static access). assisted-by Claude claude-opus-4-8
   */
  isServiceAccount?: boolean;
}

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const OPENFGA_EMAIL_PRINCIPAL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/;

function isValidOpenFgaId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && OPENFGA_ID_PATTERN.test(value);
}

function normalizeOpenFgaEmailPrincipal(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return OPENFGA_EMAIL_PRINCIPAL_PATTERN.test(normalized) ? normalized : null;
}

function authzResponse(
  body: {
    error: string;
    code: string;
    reason: string;
    action: string;
  },
  status: number,
): NextResponse {
  return NextResponse.json({ success: false, ...body }, { status });
}

export async function requireAgentUsePermission({
  subject,
  agentId,
  email,
  tenantId = "default",
  correlationId,
  traceparent,
  isServiceAccount = false,
}: AgentUsePermissionInput): Promise<NextResponse | null> {
  if (!isValidOpenFgaId(subject)) {
    return authzResponse(
      {
        error: "You are not signed in. Please sign in to continue.",
        code: "NOT_SIGNED_IN",
        reason: "not_signed_in",
        action: "sign_in",
      },
      401,
    );
  }

  if (!isValidOpenFgaId(agentId)) {
    return authzResponse(
      {
        error: "Invalid agent identifier",
        code: "INVALID_AGENT_ID",
        reason: "invalid_request",
        action: "fix_request",
      },
      400,
    );
  }

  return withAuthzSpan(
    "authz.webui_backend.agent_use",
    {
      "authz.action": "can_use",
      "authz.resource": "dynamic_agent",
      "authz.agent_id": String(agentId),
      "authz.tenant_id": tenantId,
    },
    async () => {
      // Namespace the OpenFGA subject. Service-account callers
      // (client-credentials) are graphed as `service_account:<sub>` — their
      // grants are written under that type, so checking `user:<sub>` would
      // wrongly deny (same class of bug fixed in the DA backend WS-G and the
      // bridge WS-F; this is the BFF agent-use layer). T002 canonical rule.
      // Computed OUTSIDE the try so the PDP-error audit path below reuses the
      // correctly-namespaced resourceRef (FR-027/SC-009 — an SA must not be
      // mislabeled as user:<sub> in audit on a PDP error).
      const namespacedSubject = isServiceAccount
        ? `service_account:${subject}`
        : `user:${subject}`;
      const resourceRef = `${namespacedSubject} can_use agent:${agentId}`;
      try {
        // Service accounts are authorized ONLY by their own direct grants. The
        // email-principal alias and the team-union fallback are human/user
        // concepts (an SA has no email identity and its access is static, not
        // team-derived — FR-020), so they are skipped for SA subjects.
        const userCandidates = [namespacedSubject];
        if (!isServiceAccount) {
          const emailPrincipal = normalizeOpenFgaEmailPrincipal(email);
          if (emailPrincipal) {
            userCandidates.push(`user:${emailPrincipal}`);
          }
        }
        let allowed = false;
        let reasonCode: "ALLOW_DIRECT" | "ALLOW_TEAM_UNION" = "ALLOW_DIRECT";
        let matchedTeamSlug: string | undefined;
        for (const user of userCandidates) {
          const decision = await checkOpenFgaTuple({
            user,
            relation: "can_use",
            object: `agent:${agentId}`,
          });
          if (decision.allowed) {
            allowed = true;
            break;
          }
        }
        // Phase 2.7 of spec 2026-05-24-derive-team-from-channel
        // (FR-038): if no direct grant exists, fall back to a
        // team-union probe. Today the Web UI only honors direct
        // grants; this broadening lets team-mediated agent access
        // flow through the same code path the bots use via
        // evaluateAgentAccess(). We only run this when the cheap
        // direct paths have already failed so the common allow
        // case is unchanged in latency. Skipped for service accounts —
        // their access is direct grants only, never team-mediated.
        if (!allowed && !isServiceAccount) {
          const teamSlugs = await listUserTeamSlugs({ subject: String(subject) });
          for (const slug of teamSlugs) {
            const teamDecision = await checkOpenFgaTuple({
              user: `team:${slug}#member`,
              relation: "can_use",
              object: `agent:${agentId}`,
            });
            if (teamDecision.allowed) {
              allowed = true;
              reasonCode = "ALLOW_TEAM_UNION";
              matchedTeamSlug = slug;
              break;
            }
          }
        }
        if (allowed) {
          logOpenFgaRebacAuditEvent({
            tenantId,
            sub: subject,
            operation: "agent_use_check",
            resource: "dynamic_agent",
            scope: "use",
            outcome: "allow",
            reasonCode: reasonCode === "ALLOW_TEAM_UNION" ? "ALLOW_TEAM_UNION" : "OK",
            pdp: "openfga",
            resourceRef:
              matchedTeamSlug !== undefined
                ? `team:${matchedTeamSlug}#member can_use agent:${agentId}`
                : resourceRef,
            email,
            correlationId,
          });
          return null;
        }
        logOpenFgaRebacAuditEvent({
          tenantId,
          sub: subject,
          operation: "agent_use_check",
          resource: "dynamic_agent",
          scope: "use",
          outcome: "deny",
          reasonCode: "DENY_NO_CAPABILITY",
          pdp: "openfga",
          resourceRef,
          email,
          correlationId,
        });
      } catch (err) {
        console.error(
          `[openfga-agent-authz] OpenFGA check failed for agent=${agentId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        logOpenFgaRebacAuditEvent({
          tenantId,
          sub: subject,
          operation: "agent_use_check",
          resource: "dynamic_agent",
          scope: "use",
          outcome: "deny",
          reasonCode: "DENY_PDP_UNAVAILABLE",
          pdp: "openfga",
          resourceRef,
          email,
          correlationId,
        });
        return authzResponse(
          {
            error: "Authorization service is temporarily unavailable. Please try again in a moment.",
            code: "PDP_UNAVAILABLE",
            reason: "pdp_unavailable",
            action: "retry",
          },
          503,
        );
      }

      return authzResponse(
        {
          error: "Permission denied",
          code: "agent#use",
          reason: "pdp_denied",
          action: "contact_admin",
        },
        403,
      );
    },
    traceparent,
  );
}
