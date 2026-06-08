import { NextRequest } from "next/server";

import { ApiError } from "@/lib/api-middleware";
import { DEFAULT_CONNECTOR_ID, isImplementedConnector } from "@/lib/rbac/idp-connectors";

/**
 * Resolve the `?provider=` query param for the directory-sync routes,
 * defaulting to the only implemented connector and rejecting unknown ones.
 */
export function resolveProviderParam(request: NextRequest): string {
  const provider = request.nextUrl.searchParams.get("provider")?.trim() || DEFAULT_CONNECTOR_ID;
  if (!isImplementedConnector(provider)) {
    throw new ApiError(`Unknown or unimplemented directory connector: "${provider}"`, 400);
  }
  return provider;
}
