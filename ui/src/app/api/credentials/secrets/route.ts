import { NextRequest } from "next/server";

// assisted-by Codex Codex-sonnet-4-6

import {
ApiError,
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import type { SecretMetadata } from "@/lib/credentials/secret-service";
import { getCredentialSecretService } from "@/lib/credentials/secret-service-factory";
import type {
  CredentialOwnerRef,
  CredentialOwnerType,
  CredentialSecretType,
} from "@/lib/credentials/types";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

interface CredentialRouteSession {
  sub?: unknown;
  user?: {
    email?: string | null;
    name?: string | null;
    displayName?: string | null;
  } | null;
}

function ownerDisplayFieldsFromSession(session: CredentialRouteSession): Partial<CredentialOwnerRef> {
  const email = typeof session.user?.email === "string" && session.user.email.trim()
    ? session.user.email.trim()
    : undefined;
  const name = typeof session.user?.name === "string" && session.user.name.trim()
    ? session.user.name.trim()
    : undefined;
  const displayName = typeof session.user?.displayName === "string" && session.user.displayName.trim()
    ? session.user.displayName.trim()
    : undefined;

  return {
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(displayName ? { displayName } : {}),
  };
}

async function ownerFromRequest(
  session: CredentialRouteSession,
  body?: Record<string, unknown>,
): Promise<CredentialOwnerRef> {
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
  return {
    type,
    id,
    ...(type === "user" ? ownerDisplayFieldsFromSession(session) : {}),
  };
}

function labelCurrentOwner(
  secrets: SecretMetadata[],
  owner: CredentialOwnerRef,
): SecretMetadata[] {
  if (owner.type !== "user") return secrets;
  const displayFields = ownerDisplayFieldsFromSession({ user: owner });
  if (Object.keys(displayFields).length === 0) return secrets;

  return secrets.map((secret) => {
    if (secret.owner?.type !== "user" || secret.owner.id !== owner.id) return secret;
    return {
      ...secret,
      owner: {
        ...secret.owner,
        ...displayFields,
      },
    };
  });
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
  const owner = await ownerFromRequest(session);
  const secrets = await service.listSecrets({
    session,
    owner,
  });

  return successResponse(labelCurrentOwner(secrets, owner));
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
