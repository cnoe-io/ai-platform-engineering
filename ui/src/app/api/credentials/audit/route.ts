import { NextRequest } from "next/server";

import {
ApiError,
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { CREDENTIAL_COLLECTIONS } from "@/lib/credentials/collections";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { getCollection } from "@/lib/mongodb";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  const actorId = typeof session.sub === "string" ? session.sub : "";
  if (!actorId) {
    throw new ApiError("Authenticated subject is required", 401, "UNAUTHORIZED");
  }
  const audit = await getCollection(CREDENTIAL_COLLECTIONS.auditEvents);
  const events = await audit
    .find({ "actor.id": actorId })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  return successResponse(events);
});
