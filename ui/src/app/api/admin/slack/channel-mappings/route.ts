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

type ChannelMappingDoc = {
  _id: ObjectId;
  slack_channel_id: string;
  team_id: string;
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

    const coll = await getCollection<ChannelMappingDoc>("channel_team_mappings");
    const teams = await getCollection<{ _id: ObjectId; name: string }>("teams");
    const raw = await coll.find({}).sort({ created_at: -1 }).limit(500).toArray();

    const items = await Promise.all(
      raw.map(async (m) => {
        let teamName = "";
        let teamMissing = false;
        try {
          const oid = ObjectId.isValid(m.team_id) ? new ObjectId(m.team_id) : null;
          const t = oid
            ? await teams.findOne({ _id: oid })
            : await teams.findOne({ _id: m.team_id as unknown as ObjectId });
          if (!t) teamMissing = true;
          else teamName = String(t.name ?? "");
        } catch {
          teamMissing = true;
        }

        return {
          id: m._id.toString(),
          slack_channel_id: m.slack_channel_id,
          team_id: m.team_id,
          team_name: teamName,
          slack_workspace_id: m.slack_workspace_id,
          channel_name: m.channel_name,
          created_by: m.created_by,
          created_at: m.created_at?.toISOString?.() ?? null,
          active: m.active !== false,
          stale_team: teamMissing,
          stale_channel_archived: false,
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
      team_id?: unknown;
      channel_name?: unknown;
      workspace_id?: unknown;
    };

    if (typeof body.slack_channel_id !== "string" || !body.slack_channel_id.trim()) {
      throw new ApiError("slack_channel_id is required", 400);
    }
    if (typeof body.team_id !== "string" || !body.team_id.trim()) {
      throw new ApiError("team_id is required", 400);
    }
    const channelName =
      typeof body.channel_name === "string" && body.channel_name.trim()
        ? body.channel_name.trim()
        : body.slack_channel_id.trim();
    const workspaceId =
      typeof body.workspace_id === "string" && body.workspace_id.trim()
        ? body.workspace_id.trim()
        : "unknown";

    const teams = await getCollection<{ _id: ObjectId }>("teams");
    const oid = ObjectId.isValid(body.team_id) ? new ObjectId(body.team_id) : null;
    const teamOk = oid
      ? await teams.findOne({ _id: oid })
      : await teams.findOne({ _id: body.team_id as unknown as ObjectId });
    if (!teamOk) {
      throw new ApiError("Team does not exist", 400);
    }

    const coll = await getCollection<ChannelMappingDoc>("channel_team_mappings");
    const now = new Date();
    const doc = {
      slack_channel_id: body.slack_channel_id.trim(),
      team_id: body.team_id.trim(),
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

    const coll = await getCollection<ChannelMappingDoc>("channel_team_mappings");
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
