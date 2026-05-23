import { NextRequest, NextResponse } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { listIdentityProviders } from "@/lib/rbac/identity-provider-store";

import { withIdentityGroupSyncViewAuth } from "../_lib";

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: "MongoDB not configured - identity group sync requires MongoDB",
        code: "MONGODB_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  return withIdentityGroupSyncViewAuth(request, async () => {
    const providers = await listIdentityProviders();
    return successResponse({ providers, total: providers.length });
  });
});
