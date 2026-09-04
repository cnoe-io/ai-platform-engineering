/**
 * User-managed API token for the TOME MCP connector surface.
 *
 * POST returns the raw token once. GET returns metadata only. DELETE revokes
 * the current user's active token. All operations require a browser-backed
 * NextAuth session; a TOME API token cannot mint or manage another token.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  getAuthenticatedUser,
  handleApiError,
} from "@/lib/api-middleware";
import { ApiError } from "@/lib/api-error";
import {
  createTomeApiKey,
  getActiveTomeApiKey,
  resolveTomeApiKeyOwner,
  revokeActiveTomeApiKeys,
} from "@/lib/tome-api-keys";
import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

const MAX_EXPIRY_DAYS = 90;

function requireTome(): void {
  if (!isTomeServerEnabled()) {
    throw new ApiError("Not found", 404, "NOT_FOUND");
  }
}

async function ownerFromSession(request: NextRequest): Promise<{
  sub: string;
  email: string;
  name: string;
}> {
  const { user, session } = await getAuthenticatedUser(request);
  const sub = resolveTomeApiKeyOwner(session);
  if (!sub) {
    throw new ApiError(
      "A stable identity is required to mint a Tome API token",
      403,
      "STABLE_IDENTITY_REQUIRED",
    );
  }
  return { sub, email: user.email, name: user.name };
}

export async function GET(request: NextRequest) {
  try {
    requireTome();
    const owner = await ownerFromSession(request);
    const active = await getActiveTomeApiKey(owner.sub);
    return NextResponse.json({
      has_active_token: !!active,
      ...(active
        ? {
            key_id: active.key_id,
            created_at: active.created_at,
            expires_at: active.expires_at,
          }
        : {}),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireTome();
    const owner = await ownerFromSession(request);
    let expiresInDays = MAX_EXPIRY_DAYS;

    try {
      const body = (await request.json()) as { expires_in_days?: unknown };
      if (body.expires_in_days !== undefined) {
        expiresInDays = Number(body.expires_in_days);
      }
    } catch {
      // Empty body is valid and uses the maximum supported lifetime.
    }

    if (
      !Number.isInteger(expiresInDays) ||
      expiresInDays < 1 ||
      expiresInDays > MAX_EXPIRY_DAYS
    ) {
      return NextResponse.json(
        { error: `expires_in_days must be an integer between 1 and ${MAX_EXPIRY_DAYS}` },
        { status: 400 },
      );
    }

    const created = await createTomeApiKey({
      ownerSub: owner.sub,
      ownerEmail: owner.email,
      ownerName: owner.name,
      expiresInDays,
    });
    return NextResponse.json({
      token: created.key,
      token_type: "ApiKey",
      header_name: "x-caipe-token",
      expires_in: expiresInDays * 86_400,
      scope: "tome:mcp",
      key_id: created.keyId,
      expires_at: created.expiresAt,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    requireTome();
    const owner = await ownerFromSession(request);
    const revoked = await revokeActiveTomeApiKeys(owner.sub);
    return NextResponse.json({ revoked });
  } catch (error) {
    return handleApiError(error);
  }
}
