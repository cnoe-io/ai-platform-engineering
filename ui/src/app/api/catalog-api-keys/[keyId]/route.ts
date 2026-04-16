import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
} from "@/lib/api-middleware";

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
      const backendUrl = process.env.NEXT_PUBLIC_A2A_BASE_URL;
      if (!backendUrl) {
        return NextResponse.json(
          { error: "backend_not_configured" },
          { status: 503 },
        );
      }
      const headers: Record<string, string> = {};
      if (session.accessToken) {
        headers["Authorization"] = `Bearer ${session.accessToken}`;
      }
      const url = new URL(
        `/catalog-api-keys/${encodeURIComponent(keyId)}`,
        backendUrl,
      ).toString();
      const res = await fetch(url, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => ({}));
      return NextResponse.json(data, { status: res.status });
    });
  },
);
