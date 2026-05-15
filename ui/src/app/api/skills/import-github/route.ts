import { NextRequest } from "next/server";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  successResponse,
} from "@/lib/api-middleware";
import { runImport } from "../import/route";

/**
 * @deprecated — prefer POST /api/skills/import (source-agnostic).
 *
 * Thin proxy that injects `source: "github"` and forwards to the unified
 * importer (FR-016). Kept for back-compat with any out-of-tree callers
 * that still POST to this URL or use the legacy single-`path: string`
 * body shape.
 *
 * Response stays byte-compatible with the historical `{ files, count }`
 * shape (no `conflicts` field) so existing callers don't break.
 *
 * Body: { repo: "owner/repo", path: "skills/my-skill", credentials_ref?: string }
 *   OR  { repo: "owner/repo", paths: ["skills/a", "skills/b"], credentials_ref?: string }
 */

export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const body = (await request.json()) as Record<string, unknown>;
    const { files, count } = await runImport({ ...body, source: "github" });
    return successResponse({ files, count });
  });
});
