import { NextRequest, NextResponse } from "next/server";
import { withAuth, withErrorHandler } from "@/lib/api-middleware";

/**
 * GET /api/skills/supervisor-status — proxy to Python GET /internal/supervisor/skills-status.
 * Any authenticated user (Try skills gateway / FR-026); admin UI may use the same route.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, _user, session) => {
    const backendUrl = process.env.NEXT_PUBLIC_A2A_BASE_URL;
    if (!backendUrl) {
      return NextResponse.json(
        {
          mas_registered: false,
          graph_generation: null,
          skills_loaded_count: null,
          skills_merged_at: null,
          catalog_cache_generation: null,
          message: "NEXT_PUBLIC_A2A_BASE_URL is not set.",
        },
        { status: 200 },
      );
    }

    const headers: Record<string, string> = {};
    if (session.accessToken) {
      headers["Authorization"] = `Bearer ${session.accessToken}`;
    }

    const url = new URL("/internal/supervisor/skills-status", backendUrl).toString();
    try {
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(30_000),
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
          mas_registered: false,
          graph_generation: null,
          skills_loaded_count: null,
          skills_merged_at: null,
          catalog_cache_generation: null,
          message: isConnRefused
            ? `Supervisor backend not reachable at ${backendUrl}.`
            : `Supervisor backend error: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 200 },
      );
    }
  });
});
