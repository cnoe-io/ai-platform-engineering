// assisted-by Codex Codex-sonnet-4-6

import { ApiError } from "@/lib/api-error";

/**
 * Server-only install gate for Agentic Apps admin/import routes.
 * Uses AGENTIC_APPS_INSTALL_ENABLED only (never NEXT_PUBLIC_*).
 */
export function requireAgenticAppsInstallEnabled(): void {
  if (process.env.AGENTIC_APPS_INSTALL_ENABLED !== "true") {
    throw new ApiError("Agentic Apps installation is not enabled", 404);
  }
}
