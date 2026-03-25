import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
} from "@/lib/api-middleware";

/**
 * POST /api/skills/refresh — proxy to Python POST /skills/refresh.
 * Invalidates catalog cache and rebuilds supervisor MAS graph (FR-012).
 * Admin only.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const backendUrl = process.env.BACKEND_SKILLS_URL;
    if (!backendUrl) {
      return NextResponse.json(
        {
          error: "backend_not_configured",
          message: "BACKEND_SKILLS_URL is not set; cannot refresh supervisor skills.",
        },
        { status: 503 },
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (session.accessToken) {
      headers["Authorization"] = `Bearer ${session.accessToken}`;
    }

    const url = new URL("/skills/refresh", backendUrl).toString();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(120_000),
      });

      const data = await res.json().catch(() => ({
        error: "invalid_response",
        message: res.statusText,
      }));
      return NextResponse.json(data, { status: res.status });
    } catch (err: unknown) {
      const code =
        err instanceof Error && "cause" in err
          ? (err.cause as { code?: string })?.code
          : undefined;
      const isConnRefused = code === "ECONNREFUSED" || code === "ECONNRESET";
      return NextResponse.json(
        {
          error: "backend_unreachable",
          message: isConnRefused
            ? `Supervisor backend not reachable at ${backendUrl}. Start the Python backend to enable rebuild.`
            : `Supervisor backend error: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 502 },
      );
    }
  });
});
