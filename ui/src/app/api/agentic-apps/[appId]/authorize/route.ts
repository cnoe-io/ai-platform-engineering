import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

import {
  evaluateAgenticAppCasCompatibility,
  type AgenticAppCasCompatibilityResult,
} from "@/lib/agentic-apps/cas-compat";
import { resolveAgenticAppExecutionBinding } from "@/lib/agentic-apps/execution-binding";
import {
  deriveAgenticAppSubjectId,
  hashAgenticAppIdentifier,
} from "@/lib/agentic-apps/identity";
import { buildPdpDecisionRecord, decideAgenticAppPdp } from "@/lib/agentic-apps/pdp";
import { findAgenticAppPolicyAction } from "@/lib/agentic-apps/policy-routing";
import {
  appendAppTokenGrant,
  appendPdpDecision,
} from "@/lib/agentic-apps/store";
import { mintAppScopedToken } from "@/lib/agentic-apps/tokens";
import { ApiError } from "@/lib/api-error";
import { getAuthenticatedUser } from "@/lib/api-middleware";

interface AuthorizeContext {
  params: Promise<{ appId: string }>;
}

type AuthorizeBody = {
  action?: unknown;
  scopes?: unknown;
  resource?: unknown;
};

/**
 * Exchange a Web UI session for a short-lived app-scoped token.
 *
 * The token broker enforces both the manifest action/scope contract and CAS
 * `agentic_app#use`. It never returns a token from shadow-only authorization.
 */
export async function POST(
  request: NextRequest,
  context: AuthorizeContext,
): Promise<Response> {
  if (process.env.AGENTIC_APPS_INSTALL_ENABLED !== "true") {
    return Response.json({ error: "app_not_found" }, { status: 404 });
  }

  let auth: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    auth = await getAuthenticatedUser(request, { allowAnonymous: false });
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  const { appId } = await context.params;
  const binding = await resolveAgenticAppExecutionBinding(appId);
  if (binding.error) {
    return Response.json({ error: binding.error }, { status: binding.status });
  }

  const body = await readAuthorizeBody(request);
  if (body.ok === false) return body.response;
  if (
    body.value.resource &&
    (body.value.resource.type !== "agentic_app" || body.value.resource.id !== appId)
  ) {
    return Response.json({ error: "resource_mismatch" }, { status: 400 });
  }

  const correlationId = request.headers.get("x-correlation-id") ?? randomUUID();
  const subjectId = deriveAgenticAppSubjectId(
    auth.session as Record<string, unknown>,
    auth.user.email,
  );
  const localDecision = decideAgenticAppPdp({
    action: body.value.action,
    user: auth.user,
    session: auth.session,
    pkg: binding.pkg,
    installation: binding.installation,
    ...(body.value.scopes ? { scopes: body.value.scopes } : {}),
    metadata: { source: "agentic-app-token-exchange" },
  });
  const policyAction = findAgenticAppPolicyAction(binding.pkg.manifest, body.value.action);
  const casCompatibility: AgenticAppCasCompatibilityResult = binding.pkg.manifest.authorization
    ? await evaluateAgenticAppCasCompatibility({
        appId,
        subjectId,
        localEffect: localDecision.effect,
        correlationId,
        mode: "enforce",
        action: policyAction?.casAction ?? "use",
      })
    : {
        mode: "enforce",
        casDecision: "DENY",
        casReason: "NO_CAPABILITY",
        effectiveEffect: "deny",
      };
  const decision = {
    ...localDecision,
    effect: casCompatibility.effectiveEffect,
    reasonCode:
      casCompatibility.effectiveEffect === "deny" && localDecision.effect === "allow"
        ? `cas_${(casCompatibility.casReason ?? "NO_CAPABILITY").toLowerCase()}`
        : localDecision.reasonCode,
    scopes: casCompatibility.effectiveEffect === "allow" ? localDecision.scopes : [],
    metadata: {
      ...localDecision.metadata,
      casMode: casCompatibility.mode,
      casDecision: casCompatibility.casDecision,
      ...(casCompatibility.casReason ? { casReason: casCompatibility.casReason } : {}),
    },
  };

  await appendPdpDecision(
    buildPdpDecisionRecord({
      appId,
      action: body.value.action,
      decision,
      correlationId,
      userSubjectHash: hashAgenticAppIdentifier(subjectId),
      route: request.url,
      method: "POST",
    }),
  );

  if (decision.effect !== "allow") {
    const unavailable = casCompatibility.casReason === "AUTHZ_UNAVAILABLE";
    return Response.json(
      {
        error: unavailable ? "authorization_unavailable" : "pdp_denied",
        decisionId: decision.decisionId,
        correlationId,
        reasonCode: decision.reasonCode,
      },
      {
        status: unavailable ? 503 : 403,
        headers: decisionHeaders(decision.decisionId, correlationId, casCompatibility),
      },
    );
  }

  const appToken = await mintAppScopedToken({
    appId,
    subject: subjectId,
    email: auth.user.email,
    scopes: decision.scopes,
    decisionId: decision.decisionId,
    correlationId,
  });
  await appendAppTokenGrant({
    jti: appToken.jti,
    decisionId: decision.decisionId,
    correlationId,
    appId,
    audience: appToken.audience,
    scopes: decision.scopes,
    issuedAt: new Date().toISOString(),
    expiresAt: appToken.expiresAt,
    subject: { subjectHash: hashAgenticAppIdentifier(subjectId) },
    tokenHash: appToken.tokenHash,
  });

  return Response.json(
    {
      decisionId: decision.decisionId,
      correlationId,
      token: appToken.token,
      expiresAt: appToken.expiresAt,
      scopes: decision.scopes,
    },
    {
      headers: decisionHeaders(decision.decisionId, correlationId, casCompatibility),
    },
  );
}

async function readAuthorizeBody(
  request: Request,
): Promise<
  | {
      ok: true;
      value: {
        action: string;
        scopes?: string[];
        resource?: Record<string, unknown>;
      };
    }
  | { ok: false; response: Response }
> {
  let body: AuthorizeBody;
  try {
    body = await request.json() as AuthorizeBody;
  } catch {
    return { ok: false, response: Response.json({ error: "invalid_json" }, { status: 400 }) };
  }
  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!action) {
    return { ok: false, response: Response.json({ error: "action_required" }, { status: 400 }) };
  }
  if (
    body.scopes !== undefined &&
    (!Array.isArray(body.scopes) || !body.scopes.every((scope) => typeof scope === "string"))
  ) {
    return { ok: false, response: Response.json({ error: "invalid_scopes" }, { status: 400 }) };
  }
  if (body.resource !== undefined && (!body.resource || typeof body.resource !== "object" || Array.isArray(body.resource))) {
    return { ok: false, response: Response.json({ error: "invalid_resource" }, { status: 400 }) };
  }
  return {
    ok: true,
    value: {
      action,
      ...(Array.isArray(body.scopes) ? { scopes: body.scopes } : {}),
      ...(isRecord(body.resource) ? { resource: body.resource } : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decisionHeaders(
  decisionId: string,
  correlationId: string,
  cas: AgenticAppCasCompatibilityResult,
): Headers {
  return new Headers({
    "cache-control": "no-store",
    "x-caipe-decision-id": decisionId,
    "x-correlation-id": correlationId,
    "x-caipe-cas-mode": cas.mode,
    "x-caipe-cas-decision": cas.casDecision,
  });
}
