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
  withErrorHandler,
  getPaginationParams,
  paginatedResponse,
  getAuthFromBearerOrSession,
  requireRbacPermission,
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

  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "dynamic_agent", "manage");

    const { page, pageSize, skip } = getPaginationParams(request);
    const url = new URL(request.url);

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

      // Batch-fetch message counts for WebUI conversations
      const webuiIds = items
        .filter((item) => item.client_type === "webui")
        .map((item) => item.id);
      if (webuiIds.length > 0) {
        try {
          const messagesCol = await getCollection("messages");
          const msgCounts: any[] = await messagesCol
            .aggregate([
              { $match: { conversation_id: { $in: webuiIds } } },
              { $group: { _id: "$conversation_id", count: { $sum: 1 } } },
            ])
            .toArray();
          const msgCountMap = new Map(msgCounts.map((c) => [c._id, c.count]));
          for (const item of items) {
            if (item.client_type === "webui") {
              item.message_count = msgCountMap.get(item.id) || 0;
            }
          }
        } catch {
          // messages collection may not exist
        }
      }

      // Batch-fetch GridFS file counts per (agent_id, conversation_id, "filesystem") namespace
      try {
        const gridfsFiles = await getCollection("agent_files.files");
        const namespacePairs = items
          .filter((item) => item.agent_id)
          .map((item) => [item.agent_id, item.id, "filesystem"]);

        if (namespacePairs.length > 0) {
          const fileCounts: any[] = await gridfsFiles
            .aggregate([
              { $match: { "metadata.namespace": { $in: namespacePairs } } },
              { $group: { _id: "$metadata.namespace", count: { $sum: 1 } } },
            ])
            .toArray();
          const fileCountMap = new Map(
            fileCounts.map((c) => [c._id?.[1], c.count])  // key by conversation_id (index 1)
          );
          for (const item of items) {
            item.file_count = fileCountMap.get(item.id) || 0;
          }
        }
      } catch {
        // GridFS collection may not exist yet
        for (const item of items) {
          item.file_count = 0;
        }
      }
    }

    return paginatedResponse(items, total, page, pageSize);
});
