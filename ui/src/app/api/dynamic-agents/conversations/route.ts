/**
 * Admin route for listing all Dynamic Agent conversations.
 *
 * GET /api/dynamic-agents/conversations?page=1&limit=20
 *
 * This queries the conversations collection directly for admin management.
 * Only returns conversations that have an agent_id (Dynamic Agent conversations).
 */

import { NextRequest } from "next/server";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  getPaginationParams,
  paginatedResponse,
} from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { getServerConfig } from "@/lib/config";
import type { Conversation } from "@/types/mongodb";

/**
 * GET /api/dynamic-agents/conversations
 * List all Dynamic Agent conversations (admin only).
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return paginatedResponse([], 0, 1, 20);
  }

  const config = getServerConfig();
  if (!config.dynamicAgentsEnabled) {
    return paginatedResponse([], 0, 1, 20);
  }

  return await withAuth(request, async (req, _user, session) => {
    requireAdmin(session);

    const { page, pageSize, skip } = getPaginationParams(req);
    const url = new URL(req.url);

    // Query parameters
    const search = url.searchParams.get("search")?.trim();
    const agentId = url.searchParams.get("agent_id")?.trim();

    // Build match stage - only Dynamic Agent conversations (have non-empty agent_id)
    const matchStage: Record<string, unknown> = {
      agent_id: { $exists: true, $nin: [null, ""] },
    };

    // General search across multiple fields (id, title, owner_id)
    if (search) {
      matchStage.$or = [
        { _id: { $regex: search, $options: "i" } },
        { title: { $regex: search, $options: "i" } },
        { owner_id: { $regex: search, $options: "i" } },
      ];
    }

    if (agentId) {
      matchStage.agent_id = agentId;
    }

    const conversations = await getCollection<Conversation>("conversations");

    const pipeline: object[] = [
      { $match: matchStage },
      // Lookup checkpoint count from conversation_checkpoints collection
      {
        $lookup: {
          from: "conversation_checkpoints",
          localField: "_id",
          foreignField: "thread_id",
          as: "_checkpoints",
        },
      },
      {
        $addFields: {
          checkpoint_count: { $size: "$_checkpoints" },
        },
      },
      { $project: { _checkpoints: 0 } },
      {
        $facet: {
          items: [
            { $sort: { updated_at: -1 as const } },
            { $skip: skip },
            { $limit: pageSize },
            {
              $project: {
                id: "$_id",
                title: 1,
                owner_id: 1,
                agent_id: 1,
                created_at: 1,
                updated_at: 1,
                checkpoint_count: 1,
                is_archived: 1,
                deleted_at: 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const [result] = await conversations.aggregate(pipeline).toArray();
    const items = result?.items || [];
    const total = result?.totalCount?.[0]?.count || 0;

    return paginatedResponse(items, total, page, pageSize);
  });
});
