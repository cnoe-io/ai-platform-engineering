// assisted-by claude code claude-sonnet-4-6
import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { loadProjectOnboardingConfig } from "@/lib/projects/onboarding-config";

export const GET = withErrorHandler(async () => {
  const config = loadProjectOnboardingConfig();
  return successResponse({ config });
});
