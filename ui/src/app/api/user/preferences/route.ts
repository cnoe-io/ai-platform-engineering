/**
 * GET  /api/user/preferences — return the signed-in user's saved
 *                              per-surface default-agent preferences.
 * PUT  /api/user/preferences — upsert (or clear when the field is null) the
 *                              user's saved default-agent for a given surface.
 *                              Accepts Web, Slack, and Webex defaults.
 *
 * The PUT path enforces that the user has `can_use` on each chosen agent via
 * the BFF PDP (`evaluateAgentAccess`). The bot re-verifies again at dispatch
 * time (spec FR-024).
 *
 * Authentication: existing `getAuthFromBearerOrSession` middleware. The
 * route does NOT accept impersonation; the signed-in subject is the only
 * principal whose preference can be read or written.
 */

import { NextRequest,NextResponse } from "next/server";

import {
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { getIntegrationAvailability } from "@/lib/integration-config";
import { getResolvedPlatformDefaultAgentId } from "@/lib/platform-default-agent";
import { evaluateAgentAccess } from "@/lib/rbac/pdp-shared";
import {
getUserPreference,
updateUserPreferences,
type UserAgentPreferenceField,
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
  const [preference, platformDefaultAgentId] = await Promise.all([
    getUserPreference({ tenantId, userId: subject }),
    getResolvedPlatformDefaultAgentId(),
  ]);
  return successResponse({
    ...preference,
    platform_default_agent_id: platformDefaultAgentId,
    integrations: getIntegrationAvailability(),
  });
});

interface PutBody {
  web_default_agent_id?: unknown;
  slack_default_agent_id?: unknown;
  webex_default_agent_id?: unknown;
}

const PREFERENCE_FIELDS: readonly UserAgentPreferenceField[] = [
  "web_default_agent_id",
  "slack_default_agent_id",
  "webex_default_agent_id",
];

/**
 * Validate one preference field and, when a non-null agent is chosen, confirm
 * it exists and the signed-in user is authorized to use it.
 */
async function validatePreferenceField(
  field: UserAgentPreferenceField,
  raw: unknown,
  ctx: { tenantId: string; subject: string },
): Promise<{ value: string | null; error: NextResponse | null }> {
  if (raw === null) {
    return { value: null, error: null };
  }

  if (typeof raw !== "string" || !OPENFGA_ID_PATTERN.test(raw)) {
    return {
      value: null,
      error: errorResponse(400, {
        error: `${field} must be null or a valid agent id`,
        code: "INVALID_BODY",
        reason: "invalid_body",
        action: "fix_request",
      }),
    };
  }
  const agentId = raw;

  // Verify the agent actually exists before issuing a PDP probe to keep audit
  // logs honest and to give the user a precise 404 rather than a 403.
  const agentsCollection = await getCollection<{ _id: unknown }>("dynamic_agents");
  const existing = await agentsCollection.findOne({
    _id: agentId,
  } as never);
  if (!existing) {
    return {
      value: null,
      error: errorResponse(404, {
        error: "Agent not found",
        code: "AGENT_NOT_FOUND",
        reason: "agent_not_found",
        action: "pick_another",
      }),
    };
  }

  let decision;
  try {
    decision = await evaluateAgentAccess({ subject: ctx.subject, agentId });
  } catch (err) {
    console.error(
      "[user-preferences] PDP error while validating chosen agent",
      err instanceof Error ? err.message : String(err),
    );
    return {
      value: null,
      error: errorResponse(502, {
        error: "Authorization service is temporarily unavailable. Please try again in a moment.",
        code: "PDP_UNAVAILABLE",
        reason: "pdp_unavailable",
        action: "retry",
      }),
    };
  }

  if (!decision.allowed) {
    return {
      value: null,
      error: errorResponse(403, {
        error: "You do not have permission to use the selected agent.",
        code: "FORBIDDEN_AGENT",
        reason: "pdp_denied",
        action: "pick_another",
      }),
    };
  }

  return { value: agentId, error: null };
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

  // Only act on fields the caller actually included, so one surface's update
  // never disturbs another surface's default.
  const provided = PREFERENCE_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );
  if (provided.length === 0) {
    return errorResponse(400, {
      error: "Provide a supported default-agent preference field",
      code: "INVALID_BODY",
      reason: "invalid_body",
      action: "fix_request",
    });
  }

  const result: Partial<Record<UserAgentPreferenceField,string | null>> = {};
  for (const field of provided) {
    const validation = await validatePreferenceField(
      field,
      (body as Record<string, unknown>)[field],
      { tenantId, subject },
    );
    if (validation.error) return validation.error;
    result[field] = validation.value;
  }

  await updateUserPreferences({
    tenantId,
    userId: subject,
    preferences: result,
  });

  return successResponse(result);
});
