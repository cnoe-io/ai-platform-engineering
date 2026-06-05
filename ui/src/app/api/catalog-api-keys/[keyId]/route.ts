import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
  ApiError,
} from "@/lib/api-middleware";
import {
  getCatalogApiKeyOwnerIfActive,
  resolveCatalogApiKeyOwnerId,
  revokeCatalogApiKey,
} from "@/lib/catalog-api-keys";
import { isMongoDBConfigured } from "@/lib/mongodb";

/**
 * DELETE /api/catalog-api-keys/[keyId] — revoke a catalog API key (T051).
 */

export const DELETE = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ keyId: string }> },
  ) => {
    const { keyId } = await context.params;
    return await withAuth(request, async (_req, _user, session) => {
      if (!isMongoDBConfigured) {
        throw new ApiError(
          "Skills catalog API keys require MongoDB.",
          503,
        );
      }
      const owner = resolveCatalogApiKeyOwnerId(session);
      if (!owner) {
        throw new ApiError("Authentication required", 401);
      }

      const rowOwner = await getCatalogApiKeyOwnerIfActive(keyId);
      if (rowOwner === null) {
        throw new ApiError("Key not found", 404);
      }
      if (rowOwner !== owner) {
        throw new ApiError("Forbidden", 403);
      }

      const revoked = await revokeCatalogApiKey(keyId);
      return NextResponse.json({ revoked });
    });
  },
);
