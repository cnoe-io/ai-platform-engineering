import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import {
  listAuthorizationPolicies,
  listAuthorizationPoliciesByResourceType,
  listAuthorizationPoliciesBySurface,
} from "@/lib/rbac/authorization-policy-catalog";
import type { UniversalRebacResourceType } from "@/types/rbac-universal";

import { withRebacViewAuth } from "../../_lib";

export const GET = withErrorHandler(async (request: NextRequest) =>
  withRebacViewAuth(request, async () => {
    // assisted-by Codex Codex-sonnet-4-6
    const url = new URL(request.url);
    const surface = url.searchParams.get("surface")?.trim();
    const resourceType = url.searchParams.get("resource_type")?.trim() as
      | UniversalRebacResourceType
      | undefined;
    const family = url.searchParams.get("family")?.trim();

    let policies = resourceType
      ? listAuthorizationPoliciesByResourceType(resourceType)
      : surface
        ? listAuthorizationPoliciesBySurface(surface)
        : listAuthorizationPolicies();

    if (family) {
      policies = policies.filter((policy) => policy.family === family);
    }

    return successResponse({
      policies,
      count: policies.length,
      filters: {
        surface: surface || null,
        resource_type: resourceType || null,
        family: family || null,
      },
    });
  })
);
