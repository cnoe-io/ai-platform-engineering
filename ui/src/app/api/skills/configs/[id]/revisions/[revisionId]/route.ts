import { NextRequest } from "next/server";

import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { getAgentSkillVisibleToUser } from "@/lib/agent-skill-visibility";
import { getRevision } from "@/lib/skill-revisions";

/**
 * GET /api/skills/configs/[id]/revisions/[revisionId]
 *
 * Returns a single full revision document, including the SKILL.md
 * snapshot and ancillary file contents, for diff/restore views. The
 * helper enforces that `revisionId` belongs to `id` so an attacker
 * who guesses a revision id can't read history for an unrelated
 * skill they can see — defense in depth on top of the visibility
 * check below.
 */
export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string; revisionId: string }> },
  ) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("Skills require MongoDB to be configured", 503);
    }
    const { id, revisionId } = await context.params;
    if (!id || !revisionId) {
      throw new ApiError("Skill id and revision id are required", 400);
    }
    return await withAuth(request, async (_req, user) => {
      const skill = await getAgentSkillVisibleToUser(id, user.email);
      if (!skill) {
        throw new ApiError("Skill not found", 404);
      }
      const revision = await getRevision(id, revisionId);
      if (!revision) {
        throw new ApiError("Revision not found", 404);
      }
      return successResponse({ revision });
    });
  },
);
