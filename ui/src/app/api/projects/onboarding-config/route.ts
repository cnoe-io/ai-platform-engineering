// assisted-by Cursor Composer

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { loadProjectOnboardingConfig } from "@/lib/projects/onboarding-config";

export const GET = withErrorHandler(async (request: NextRequest) => {
  await getAuthFromBearerOrSession(request);
  const config = loadProjectOnboardingConfig();
  return successResponse({ config });
});

export const dynamic = "force-dynamic";
