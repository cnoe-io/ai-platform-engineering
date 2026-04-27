import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";

const COLLECTION = "channel_agent_mappings";

type ChannelAgentMappingDoc = {
  _id: ObjectId;
  slack_channel_id: string;
  agent_id: string;
  slack_workspace_id: string;
  channel_name: string;
  created_by: string;
  created_at: Date;
  active: boolean;
};

function requireMongo() {
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB is not configured", 503);
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);
    requireMongo();

    const coll = await getCollection<ChannelAgentMappingDoc>(COLLECTION);
    const agents = await getCollection<{ _id: string; name: string }>("dynamic_agents");
    const raw = await coll.find({}).sort({ created_at: -1 }).limit(500).toArray();

    const items = await Promise.all(
      raw.map(async (m) => {
        let agentName = "";
        let agentMissing = false;
        try {
          const a = await agents.findOne({ _id: m.agent_id as unknown as string });
          if (!a) agentMissing = true;
          else agentName = String(a.name ?? "");
        } catch {
          agentMissing = true;
        }

        return {
          id: m._id.toString(),
          _id: m._id.toString(),
          slack_channel_id: m.slack_channel_id,
          agent_id: m.agent_id,
          agent_name: agentName,
          slack_workspace_id: m.slack_workspace_id,
          channel_name: m.channel_name,
          created_by: m.created_by,
          created_at: m.created_at?.toISOString?.() ?? null,
          active: m.active !== false,
          stale_agent: agentMissing,
        };
      })
    );

    return successResponse({ items });
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (_req, user, session) => {
    requireAdmin(session);
    requireMongo();

    const body = (await request.json()) as {
      slack_channel_id?: unknown;
      agent_id?: unknown;
      channel_name?: unknown;
      workspace_id?: unknown;
    };

    if (typeof body.slack_channel_id !== "string" || !body.slack_channel_id.trim()) {
      throw new ApiError("slack_channel_id is required", 400);
    }
    if (typeof body.agent_id !== "string" || !body.agent_id.trim()) {
      throw new ApiError("agent_id is required", 400);
    }
    const channelName =
      typeof body.channel_name === "string" && body.channel_name.trim()
        ? body.channel_name.trim()
        : body.slack_channel_id.trim();
    const workspaceId =
      typeof body.workspace_id === "string" && body.workspace_id.trim()
        ? body.workspace_id.trim()
        : "unknown";

    const agents = await getCollection<{ _id: string; name: string }>("dynamic_agents");
    const agentOk = await agents.findOne({ _id: body.agent_id.trim() as unknown as string });
    if (!agentOk) {
      throw new ApiError("Agent does not exist", 400);
    }

    const coll = await getCollection<ChannelAgentMappingDoc>(COLLECTION);
    const now = new Date();
    const doc = {
      slack_channel_id: body.slack_channel_id.trim(),
      agent_id: body.agent_id.trim(),
      slack_workspace_id: workspaceId,
      channel_name: channelName,
      created_by: user.email,
      created_at: now,
      active: true,
    };
    await coll.updateOne(
      { slack_channel_id: doc.slack_channel_id },
      { $set: doc },
      { upsert: true }
    );

    const saved = await coll.findOne({ slack_channel_id: doc.slack_channel_id });
    return successResponse({ id: saved?._id?.toString(), ...doc }, 201);
  });
});

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);
    requireMongo();

    let id: string | null = request.nextUrl.searchParams.get("id");
    if (!id) {
      try {
        const body = (await request.json()) as { id?: unknown };
        if (typeof body.id === "string") id = body.id;
      } catch {
        // no body
      }
    }
    if (!id?.trim()) {
      throw new ApiError("id is required", 400);
    }

    if (!ObjectId.isValid(id)) {
      throw new ApiError("Invalid mapping id", 400);
    }

    const coll = await getCollection<ChannelAgentMappingDoc>(COLLECTION);
    const res = await coll.updateOne(
      { _id: new ObjectId(id) },
      { $set: { active: false } }
    );
    if (res.matchedCount === 0) {
      throw new ApiError("Mapping not found", 404);
    }
    return successResponse({ deactivated: true });
  });
});
