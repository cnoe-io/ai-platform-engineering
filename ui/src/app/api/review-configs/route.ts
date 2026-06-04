/**
 * GET /api/review-configs — list the supported AI Review targets.
 *
 * Returns the fixed registry from `lib/server/ai-review/defaults.ts` (one
 * entry per known target — agent system prompts, SKILL.md). The admin UI
 * uses this list to render its tab navigation; per-target configs live at
 * `/api/review-configs/{id}` and self-seed defaults on first read.
 *
 * There is no POST/DELETE: adding a new target is a code change, not an
 * admin action. Editing is done per-target via PUT.
 */

import { NextRequest } from "next/server";
import { withAuth, withErrorHandler, successResponse } from "@/lib/api-middleware";
import { REVIEW_TARGETS } from "@/lib/server/ai-review/defaults";

export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async () => {
    return successResponse({
      targets: REVIEW_TARGETS.map(({ target, label, hint }) => ({
        target,
        label,
        hint,
      })),
    });
  });
});
