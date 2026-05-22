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
import { requireBaselineAdminSurfaceRead } from "@/lib/rbac/require-openfga";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  assertFeatureEnabled();
  const { session } = await getAuthFromBearerOrSession(request);
  await requireBaselineAdminSurfaceRead(session, "credentials");
  const audit = await getCollection(CREDENTIAL_COLLECTIONS.auditEvents);
  const events = await audit.find({}).sort({ createdAt: -1 }).limit(100).toArray();
  return successResponse(events);
});
