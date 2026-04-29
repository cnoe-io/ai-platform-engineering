/**
 * Admin route for listing all Dynamic Agent conversations.
 *
 * GET /api/dynamic-agents/conversations?page=1&limit=20
 *
 * This queries the conversations collection directly for admin management.
 * Only returns conversations that have an agent participant (Dynamic Agent conversations).
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

    // Build match stage — only conversations with at least one agent participant
    const matchStage: Record<string, unknown> = {
      "participants": { $elemMatch: { type: "agent" } },
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
      matchStage["participants"] = { $elemMatch: { type: "agent", id: agentId } };
    }

    const conversations = await getCollection<Conversation>("conversations");

    // Count total matching documents (separate query for CosmosDB/DocumentDB compatibility)
    const total = await conversations.countDocuments(matchStage);

    // IMPORTANT: All queries must be compatible with CosmosDB and DocumentDB.
    // Do NOT use $facet or sub-pipeline $lookup (let/pipeline) — they are unsupported.
    const pipeline: object[] = [
      { $match: matchStage },
      { $sort: { updated_at: -1 as const } },
      { $skip: skip },
      { $limit: pageSize },
      {
        $addFields: {
          // Derive agent_id for backward compat with the admin UI
          agent_id: {
            $let: {
              vars: {
                agentParticipant: {
                  $arrayElemAt: [
                    { $filter: { input: "$participants", as: "p", cond: { $eq: ["$$p.type", "agent"] } } },
                    0,
                  ],
                },
              },
              in: "$$agentParticipant.id",
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          id: "$_id",
          title: 1,
          owner_id: 1,
          agent_id: 1,
          created_at: 1,
          updated_at: 1,
          client_type: 1,
          idempotency_key: 1,
          metadata: 1,
          is_archived: 1,
          deleted_at: 1,
        },
      },
    ];

    const items: any[] = await conversations.aggregate(pipeline).toArray();

    // Batch-fetch checkpoint counts for this page (avoids sub-pipeline $lookup)
    if (items.length > 0) {
      const threadIds = items.map((item) => item.id);
      const checkpoints = await getCollection("checkpoints_conversation");
      const counts: any[] = await checkpoints
        .aggregate([
          { $match: { thread_id: { $in: threadIds } } },
          { $group: { _id: "$thread_id", count: { $sum: 1 } } },
        ])
        .toArray();
      const countMap = new Map(counts.map((c) => [c._id, c.count]));
      for (const item of items) {
        item.checkpoint_count = countMap.get(item.id) || 0;
      }
    }

    return paginatedResponse(items, total, page, pageSize);
  });
});
