/**
 * GET  /api/user/preferences — return the signed-in user's saved DM
 *                              default-agent preference.
 * PUT  /api/user/preferences — upsert (or clear when `dm_default_agent_id` is
 *                              null) the user's saved DM default-agent.
 *
 * The PUT path enforces that the user has `can_use` on the chosen agent via
 * the BFF PDP (`evaluateAgentAccess`). The bot re-verifies again at dispatch
 * time (spec FR-024).
 *
 * Authentication: existing `getAuthFromBearerOrSession` middleware. The
 * route does NOT accept impersonation; the signed-in subject is the only
 * principal whose preference can be read or written.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { evaluateAgentAccess } from "@/lib/rbac/pdp-shared";
import {
  clearUserPreference,
  getUserPreference,
  setUserPreference,
} from "@/lib/rbac/user-preferences-store";

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export const dynamic = "force-dynamic";

function errorResponse(
  status: number,
  body: { error: string; code: string; reason?: string; action?: string },
): NextResponse {
  return NextResponse.json({ success: false, ...body }, { status });
}

function resolveSubject(session: { sub?: unknown }): string | null {
  if (typeof session.sub === "string" && session.sub.trim().length > 0) {
    return session.sub.trim();
  }
  return null;
}

function resolveTenant(session: { org?: unknown }): string {
  if (typeof session.org === "string" && session.org.trim().length > 0) {
    return session.org.trim();
  }
  return "default";
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const subject = resolveSubject(session);
  if (!subject) {
    return errorResponse(401, {
      error: "You are not signed in. Please sign in to continue.",
      code: "NOT_SIGNED_IN",
      reason: "not_signed_in",
      action: "sign_in",
    });
  }
  const tenantId = resolveTenant(session);
  const preference = await getUserPreference({ tenantId, userId: subject });
  return successResponse(preference);
});

interface PutBody {
  dm_default_agent_id?: unknown;
}

export const PUT = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const subject = resolveSubject(session);
  if (!subject) {
    return errorResponse(401, {
      error: "You are not signed in. Please sign in to continue.",
      code: "NOT_SIGNED_IN",
      reason: "not_signed_in",
      action: "sign_in",
    });
  }
  const tenantId = resolveTenant(session);

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return errorResponse(400, {
      error: "Request body must be valid JSON",
      code: "INVALID_BODY",
      reason: "invalid_body",
      action: "fix_request",
    });
  }

  const raw = body.dm_default_agent_id;

  // Clear branch — no PDP check required (spec FR-029a and FR-022).
  if (raw === null) {
    await clearUserPreference({ tenantId, userId: subject });
    return successResponse({ dm_default_agent_id: null });
  }

  if (typeof raw !== "string" || !OPENFGA_ID_PATTERN.test(raw)) {
    return errorResponse(400, {
      error: "dm_default_agent_id must be null or an OpenFGA-safe agent id",
      code: "INVALID_BODY",
      reason: "invalid_body",
      action: "fix_request",
    });
  }
  const agentId = raw;

  // Verify the agent actually exists before issuing a PDP probe to keep audit
  // logs honest and to give the user a precise 404 rather than a 403.
  const agentsCollection = await getCollection<{ _id: unknown }>("dynamic_agents");
  const existing = await agentsCollection.findOne({
    _id: agentId,
  } as never);
  if (!existing) {
    return errorResponse(404, {
      error: "Agent not found",
      code: "AGENT_NOT_FOUND",
      reason: "agent_not_found",
      action: "pick_another",
    });
  }

  let decision;
  try {
    decision = await evaluateAgentAccess({ subject, agentId });
  } catch (err) {
    console.error(
      "[user-preferences] PDP error while validating chosen agent",
      err instanceof Error ? err.message : String(err),
    );
    return errorResponse(502, {
      error: "Authorization service is temporarily unavailable. Please try again in a moment.",
      code: "PDP_UNAVAILABLE",
      reason: "pdp_unavailable",
      action: "retry",
    });
  }

  if (!decision.allowed) {
    return errorResponse(403, {
      error: "You do not have permission to use the selected agent.",
      code: "FORBIDDEN_AGENT",
      reason: "pdp_denied",
      action: "pick_another",
    });
  }

  await setUserPreference({ tenantId, userId: subject, agentId });
  return successResponse({ dm_default_agent_id: agentId });
});
