import { NextRequest } from "next/server";
import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { queryRebacGraph } from "@/lib/rbac/rebac-graph";
import { withOpenFgaViewAuth } from "../_lib";

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async () => {
    const teamSlug = request.nextUrl.searchParams.get("team")?.trim() || undefined;
    const maxTuples = Math.min(
      Math.max(Number.parseInt(request.nextUrl.searchParams.get("limit") || "1000", 10), 1),
      1000
    );
    return successResponse(await queryRebacGraph({ team: teamSlug, limit: maxTuples }));
  })
);
