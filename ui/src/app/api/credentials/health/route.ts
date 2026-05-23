import { NextRequest, NextResponse } from "next/server";

import { getCredentialDependencyHealth } from "@/lib/credentials/health";
import { ApiError, getAuthFromBearerOrSession, withErrorHandler } from "@/lib/api-middleware";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { connectToDatabase } from "@/lib/mongodb";
import { isOpenFgaConfigured } from "@/lib/rbac/openfga";
import { requireBaselineAdminSurfaceRead } from "@/lib/rbac/require-openfga";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const config = getCredentialFeatureConfig();
  if (!config.enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }

  const { session } = await getAuthFromBearerOrSession(request);
  await requireBaselineAdminSurfaceRead(session, "credentials");

  const health = await getCredentialDependencyHealth({
    config: {
      enabled: config.enabled,
      keyProvider: config.keyProvider,
      cmkId: config.cmkId,
      nodeEnv: process.env.NODE_ENV,
    },
    async pingMongo() {
      const { db } = await connectToDatabase();
      const result = await db.command({ ping: 1 });
      return { ok: result.ok === 1 };
    },
    async pingPolicyService() {
      return { ok: isOpenFgaConfigured() };
    },
  });

  return NextResponse.json(health, {
    status: Object.values(health).includes("unavailable") ? 503 : 200,
  });
});
