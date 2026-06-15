import { NextRequest } from "next/server";

import {
ApiError,
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getCredentialSecretService } from "@/lib/credentials/secret-service-factory";
import type { CredentialOwnerType,CredentialSecretType } from "@/lib/credentials/types";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

async function ownerFromRequest(session: { sub?: unknown }, body?: Record<string, unknown>) {
  const subject = typeof session.sub === "string" && session.sub.trim() ? session.sub.trim() : null;
  if (!subject) {
    throw new ApiError("A stable user subject is required for credential ownership", 401, "NO_SUBJECT");
  }

  const requestedOwnerType = body?.ownerType;
  const requestedOwnerId = body?.ownerId;
  const type: CredentialOwnerType =
    requestedOwnerType === "team" || requestedOwnerType === "organization" ? requestedOwnerType : "user";
  const id = type === "user" ? subject : String(requestedOwnerId || "").trim();
  if (!id) {
    throw new ApiError("ownerId is required for team or organization credentials", 400, "VALIDATION_ERROR");
  }
  if (type === "team") {
    await requireResourcePermission(session, { type: "team", id, action: "manage" });
  }
  if (type === "organization") {
    await requireResourcePermission(session, { type: "organization", id, action: "manage" });
  }
  return { type, id };
}

function credentialSecretType(value: unknown): CredentialSecretType {
  return value === "api_key" || value === "basic_auth" || value === "bearer_token" || value === "custom"
    ? value
    : "custom";
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  const service = await getCredentialSecretService();
  const secrets = await service.listSecrets({
    session,
    owner: await ownerFromRequest(session),
  });

  return successResponse(secrets);
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  const body = (await request.json()) as Record<string, unknown>;
  const rawValue = typeof body.value === "string" ? body.value : "";
  const service = await getCredentialSecretService();
  const secret = await service.createSecret({
    session,
    owner: await ownerFromRequest(session, body),
    name: String(body.name ?? ""),
    type: credentialSecretType(body.type),
    description: typeof body.description === "string" ? body.description : undefined,
    plaintext: rawValue,
  });

  return successResponse(secret, 201);
});
