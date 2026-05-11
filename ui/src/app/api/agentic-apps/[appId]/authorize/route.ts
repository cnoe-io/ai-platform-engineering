// assisted-by Codex Codex-sonnet-4-6

import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

import { evaluateAppAccess } from "@/lib/agentic-apps/access";
import { requireAgenticAppsInstallEnabled } from "@/lib/agentic-apps/guard";
import { buildPdpDecisionRecord, decideAgenticAppPdp } from "@/lib/agentic-apps/pdp";
import {
  appendAppTokenGrant,
  appendPdpDecision,
  listAppInstallations,
  listAppPackages,
} from "@/lib/agentic-apps/store";
import { mintAppScopedToken } from "@/lib/agentic-apps/tokens";
import { ApiError, getAuthenticatedUser } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";

type AuthorizeContext = {
  params: Promise<{ appId: string }>;
};

export async function POST(request: NextRequest, context: AuthorizeContext): Promise<Response> {
  try {
    requireAgenticAppsInstallEnabled();
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json({ error: "app_not_found" }, { status: error.statusCode });
    }
    throw error;
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
  if (!isMongoDBConfigured) {
    return Response.json({ error: "mongodb_required" }, { status: 503 });
  }

  const { appId } = await context.params;
  const body = await parseBody(request);
  const action = typeof body.action === "string" ? body.action : "app:authorize";
  const requestedScopes = parseScopes(body.scopes);
  const correlationId =
    request.headers.get("x-correlation-id") ??
    (typeof body.correlationId === "string" ? body.correlationId : randomUUID());

  const [installations, packages] = await Promise.all([listAppInstallations(), listAppPackages()]);
  const installation = installations.find((candidate) => candidate.appId === appId) ?? null;
  const pkg =
    installation !== null
      ? packages.find((candidate) => candidate.packageId === installation.packageId) ?? null
      : null;

  const access = evaluateAppAccess({
    user: auth.user,
    session: auth.session,
    pkg,
    installation,
  });
  if (!access.canLaunch) {
    return Response.json({ error: "app_unauthorized" }, { status: 403 });
  }

  const subject = deriveUserId({ session: auth.session, email: auth.user.email });
  const decision = decideAgenticAppPdp({
    action,
    user: auth.user,
    session: auth.session,
    pkg,
    installation,
    scopes: requestedScopes,
    metadata: { resource: body.resource },
  });
  await appendPdpDecision(
    buildPdpDecisionRecord({
      appId,
      action,
      decision,
      correlationId,
      userSubjectHash: hashStableIdentifier(subject),
    }),
  );

  if (decision.effect !== "allow") {
    return Response.json(
      { error: "pdp_denied", decisionId: decision.decisionId, reasonCode: decision.reasonCode },
      { status: 403 },
    );
  }

  const token = await mintAppScopedToken({
    appId,
    subject,
    email: auth.user.email,
    scopes: decision.scopes,
    decisionId: decision.decisionId,
    correlationId,
  });
  await appendAppTokenGrant({
    jti: token.jti,
    decisionId: decision.decisionId,
    correlationId,
    appId,
    audience: token.audience,
    scopes: decision.scopes,
    issuedAt: new Date().toISOString(),
    expiresAt: token.expiresAt,
    subject: { subjectHash: hashStableIdentifier(subject) },
    tokenHash: token.tokenHash,
  });

  return Response.json({
    decisionId: decision.decisionId,
    correlationId,
    token: token.token,
    expiresAt: token.expiresAt,
    scopes: decision.scopes,
  });
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseScopes(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return undefined;
  }
  return value;
}

function hashStableIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deriveUserId(input: { session: unknown; email: string }): string {
  const sub =
    typeof input.session === "object" &&
    input.session !== null &&
    "sub" in input.session &&
    typeof input.session.sub === "string"
      ? input.session.sub.trim()
      : "";
  if (sub.length > 0) {
    return sub;
  }
  return hashStableIdentifier(input.email);
}
