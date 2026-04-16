import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
} from "@/lib/api-middleware";

/**
 * GET /api/catalog-api-keys — list metadata for caller’s catalog API keys.
 * POST /api/catalog-api-keys — mint a new key (one-time full key in response).
 *
 * Proxies to Python when NEXT_PUBLIC_A2A_BASE_URL is set (T051).
 */

export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, _user, session) => {
    const backendUrl = process.env.NEXT_PUBLIC_A2A_BASE_URL;
    if (!backendUrl) {
      return NextResponse.json(
        { error: "backend_not_configured", keys: [] },
        { status: 503 },
      );
    }
    const headers: Record<string, string> = {};
    if (session.accessToken) {
      headers["Authorization"] = `Bearer ${session.accessToken}`;
    }
    const url = new URL("/catalog-api-keys", backendUrl).toString();
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({ keys: [] }));
    return NextResponse.json(data, { status: res.status });
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, _user, session) => {
    const backendUrl = process.env.NEXT_PUBLIC_A2A_BASE_URL;
    if (!backendUrl) {
      return NextResponse.json(
        { error: "backend_not_configured", message: "NEXT_PUBLIC_A2A_BASE_URL is not set." },
        { status: 503 },
      );
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (session.accessToken) {
      headers["Authorization"] = `Bearer ${session.accessToken}`;
    }
    const url = new URL("/catalog-api-keys", backendUrl).toString();
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({
      error: "invalid_response",
      message: res.statusText,
    }));
    return NextResponse.json(data, { status: res.status });
  });
});
