import { ApiError } from "@/lib/api-middleware";
import { findRealmUserIdByAttribute } from "@/lib/rbac/keycloak-admin";

export async function assertWebexIdNotLinkedToOtherUser(
  webexUserId: string,
  keycloakSub: string
): Promise<void> {
  const existingOwner = await findRealmUserIdByAttribute("webex_user_id", webexUserId);
  if (existingOwner && existingOwner !== keycloakSub) {
    throw new ApiError(
      "This Webex account is already linked to a different enterprise user.",
      409,
      "WEBEX_ID_ALREADY_LINKED"
    );
  }
}
