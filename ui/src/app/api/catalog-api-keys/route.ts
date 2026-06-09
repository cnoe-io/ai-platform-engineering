import {
ApiError,
withAuth,
withErrorHandler,
} from "@/lib/api-middleware";
import {
createCatalogApiKey,
listCatalogApiKeys,
resolveCatalogApiKeyOwnerId,
} from "@/lib/catalog-api-keys";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { NextRequest,NextResponse } from "next/server";

/**
 * GET /api/catalog-api-keys — list metadata for caller’s catalog API keys.
 * POST /api/catalog-api-keys — mint a new key (one-time full key in response).
 *
 * Implemented in the BFF (Mongo `catalog_api_keys`); no supervisor proxy.
 */

export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, _user, session) => {
    if (!isMongoDBConfigured) {
      return NextResponse.json(
        { error: "mongodb_not_configured", keys: [] },
        { status: 503 },
      );
    }
    const owner = resolveCatalogApiKeyOwnerId(session);
    if (!owner) {
      throw new ApiError("Authentication required", 401);
    }
    const keys = await listCatalogApiKeys(owner);
    return NextResponse.json({ keys });
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, _user, session) => {
    if (!isMongoDBConfigured) {
      throw new ApiError(
        "Skills catalog API keys require MongoDB. Set MONGODB_URI and MONGODB_DATABASE.",
        503,
      );
    }
    const owner = resolveCatalogApiKeyOwnerId(session);
    if (!owner) {
      throw new ApiError("Authentication required", 401);
    }
    try {
      const { key, key_id } = await createCatalogApiKey(owner, ["catalog:read"]);
      return NextResponse.json({ key, key_id });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to persist API key";
      throw new ApiError(message, 503);
    }
  });
});
