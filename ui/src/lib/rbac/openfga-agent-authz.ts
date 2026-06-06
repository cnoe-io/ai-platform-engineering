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
      try {
        const resourceRef = `user:${subject} can_use agent:${agentId}`;
        const userCandidates = [`user:${subject}`];
        const emailPrincipal = normalizeOpenFgaEmailPrincipal(email);
        if (emailPrincipal) {
          userCandidates.push(`user:${emailPrincipal}`);
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
        // case is unchanged in latency.
        if (!allowed) {
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
          resourceRef: `user:${subject} can_use agent:${agentId}`,
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
