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
import { getCollection } from "@/lib/mongodb";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { requireAdminSurfaceManage } from "@/lib/rbac/require-openfga";
import type { User } from "@/types/mongodb";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

type UserPrincipalRef = SecretMetadata["owner"] | NonNullable<SecretMetadata["createdBy"]>;

function collectUserPrincipalIds(secrets: SecretMetadata[]): string[] {
  const ids = new Set<string>();
  for (const secret of secrets) {
    if (secret.owner.type === "user") ids.add(secret.owner.id);
    if (secret.createdBy?.type === "user") ids.add(secret.createdBy.id);
  }
  return Array.from(ids);
}

function indexUserIdentity(userIndex: Map<string, User>, user: User): void {
  if (user.keycloak_sub) userIndex.set(user.keycloak_sub, user);
  if (user.metadata?.keycloak_sub) userIndex.set(user.metadata.keycloak_sub, user);
  if (user.metadata?.sso_id) userIndex.set(user.metadata.sso_id, user);
}

function labelUserPrincipal<T extends UserPrincipalRef>(principal: T, userIndex: Map<string, User>): T {
  if (principal.type !== "user") return principal;
  const user = userIndex.get(principal.id);
  if (!user) return principal;
  return {
    ...principal,
    email: principal.email ?? user.email,
    name: principal.name ?? user.name,
    displayName: principal.displayName ?? user.name,
  };
}

async function labelSecretPrincipals(secrets: SecretMetadata[]): Promise<SecretMetadata[]> {
  const userIds = collectUserPrincipalIds(secrets);
  if (userIds.length === 0) return secrets;

  try {
    const users = await (await getCollection<User>("users")).find({
      $or: [
        { keycloak_sub: { $in: userIds } },
        { "metadata.keycloak_sub": { $in: userIds } },
        { "metadata.sso_id": { $in: userIds } },
      ],
    }).toArray();
    const userIndex = new Map<string, User>();
    users.forEach((user) => indexUserIdentity(userIndex, user));

    return secrets.map((secret) => ({
      ...secret,
      owner: labelUserPrincipal(secret.owner, userIndex),
      createdBy: secret.createdBy ? labelUserPrincipal(secret.createdBy, userIndex) : undefined,
    }));
  } catch (error) {
    console.warn("[Credentials] Could not enrich secret identity labels:", error);
    return secrets;
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  await requireAdminSurfaceManage(session, "credentials");
  const service = await getCredentialSecretService();
  return successResponse(await labelSecretPrincipals(await service.listAllSecretsForAdmin()));
});
