import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  ApiError,
} from "@/lib/api-middleware";
import { getHubSkills } from "@/lib/hub-crawl";
import type { SkillHubDoc } from "@/lib/hub-crawl";

/**
 * POST /api/skill-hubs/[id]/refresh
 *
 * Force-recrawl a hub, bypassing the MongoDB cache. Writes fresh skill
 * content into `hub_skills` and removes skills no longer present in the repo.
 * Admin only.
 *
 * Response:
 *   200  { skills_count: number, hub_id: string }
 *   404  hub not found
 *   503  MongoDB not configured
 */
export const POST = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    if (!isMongoDBConfigured) {
      throw new ApiError("Skill hubs require MongoDB to be configured", 503);
    }

    return await withAuth(request, async (_req, _user, session) => {
      requireAdmin(session);

      const { id } = await context.params;

      const collection = await getCollection("skill_hubs");
      const hubDoc = await collection.findOne({ id });
      if (!hubDoc) {
        throw new ApiError(`Hub not found: ${id}`, 404);
      }

      const { _id, ...hub } = hubDoc as any;
      const skills = await getHubSkills(hub as SkillHubDoc, /* forceFresh */ true);

      return NextResponse.json({ hub_id: id, skills_count: skills.length });
    });
  },
);
