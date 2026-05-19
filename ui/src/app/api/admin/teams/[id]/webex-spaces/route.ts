/**
 * Team-scoped Webex space assignment.
 *
 * GET  /api/admin/teams/[id]/webex-spaces
 * PUT  /api/admin/teams/[id]/webex-spaces
 *   body: { spaces: Array<{ webex_space_id, space_name, webex_workspace_id? }> }
 */

import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  getAuthFromBearerOrSession,
  withErrorHandler,
  successResponse,
  requireRbacPermission,
  ApiError,
} from "@/lib/api-middleware";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import { webexWorkspaceRef } from "@/lib/rbac/webex-space-grant-store";
import type { Team } from "@/types/teams";

interface WebexSpaceTeamMappingDoc {
  _id?: ObjectId;
  webex_space_id: string;
  team_id: string;
  space_name?: string;
  space_title?: string;
  webex_workspace_id?: string;
  active?: boolean;
  created_by?: string;
  created_at?: Date;
  updated_at?: Date;
}

interface WebexSpaceInput {
  webex_space_id: string;
  space_name: string;
  webex_workspace_id?: string;
}

function requireMongoDB() {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: "MongoDB not configured - team Webex space mappings require MongoDB",
        code: "MONGODB_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }
  return null;
}

function parseTeamId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new ApiError("Invalid team ID format", 400);
  }
  return new ObjectId(id);
}

const WEBEX_SPACE_ID_RE = /^[a-zA-Z0-9_-]{8,}$/;

function parseSpaceInput(value: unknown, idx: number): WebexSpaceInput {
  if (!value || typeof value !== "object") {
    throw new ApiError(`spaces[${idx}] must be an object`, 400);
  }
  const v = value as Record<string, unknown>;

  const webexSpaceId = typeof v.webex_space_id === "string" ? v.webex_space_id.trim() : "";
  if (!webexSpaceId) {
    throw new ApiError(`spaces[${idx}].webex_space_id is required`, 400);
  }
  if (!WEBEX_SPACE_ID_RE.test(webexSpaceId)) {
    throw new ApiError(
      `spaces[${idx}].webex_space_id "${webexSpaceId}" doesn't look like a Webex space ID`,
      400
    );
  }

  const spaceName =
    typeof v.space_name === "string" && v.space_name.trim()
      ? v.space_name.trim()
      : typeof v.space_title === "string" && v.space_title.trim()
        ? v.space_title.trim()
        : webexSpaceId;

  const workspaceId =
    typeof v.webex_workspace_id === "string" && v.webex_workspace_id.trim()
      ? v.webex_workspace_id.trim()
      : undefined;

  return {
    webex_space_id: webexSpaceId,
    space_name: spaceName,
    webex_workspace_id: webexWorkspaceRef(workspaceId),
  };
}

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    const { user, session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, "team", "view");

    const { id } = await context.params;
    const teamId = parseTeamId(id);
    const teamIdStr = id;

    const teamsCol = await getCollection<Team>("teams");
    const team = await teamsCol.findOne({ _id: teamId } as never);
    if (!team) throw new ApiError("Team not found", 404);

    const teamCol = await getRbacCollection<WebexSpaceTeamMappingDoc>("webexSpaceTeamMappings");

    const teamMappings = await teamCol
      .find({ team_id: teamIdStr, active: { $ne: false } } as never)
      .sort({ space_name: 1, space_title: 1 })
      .toArray();

    const spaces = teamMappings.map((m) => ({
      webex_space_id: m.webex_space_id,
      space_name: m.space_name ?? m.space_title ?? m.webex_space_id,
      webex_workspace_id: webexWorkspaceRef(m.webex_workspace_id),
    }));

    console.log(
      `[Admin TeamWebexSpaces] GET team=${teamIdStr} spaces=${spaces.length} by=${user.email}`
    );

    return successResponse({
      team_id: teamIdStr,
      spaces,
    });
  }
);

interface PutBody {
  spaces?: unknown;
}

export const PUT = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    const { user, session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, "team", "manage");

    const { id } = await context.params;
    const teamId = parseTeamId(id);
    const teamIdStr = id;

    let body: PutBody;
    try {
      body = (await request.json()) as PutBody;
    } catch {
      throw new ApiError("Invalid JSON body", 400);
    }

    if (!Array.isArray(body.spaces)) {
      throw new ApiError("spaces must be an array", 400);
    }

    const inputs: WebexSpaceInput[] = body.spaces.map((s, i) => parseSpaceInput(s, i));

    const bySpace = new Map<string, WebexSpaceInput>();
    for (const s of inputs) bySpace.set(s.webex_space_id, s);
    const next = Array.from(bySpace.values());

    const teamsCol = await getCollection<Team>("teams");
    const team = await teamsCol.findOne({ _id: teamId } as never);
    if (!team) throw new ApiError("Team not found", 404);

    const teamCol = await getRbacCollection<WebexSpaceTeamMappingDoc>("webexSpaceTeamMappings");

    const conflictingSpaceIds = next.map((s) => s.webex_space_id);
    if (conflictingSpaceIds.length > 0) {
      const conflicts = await teamCol
        .find({
          webex_space_id: { $in: conflictingSpaceIds },
          team_id: { $ne: teamIdStr },
          active: { $ne: false },
        } as never)
        .toArray();
      if (conflicts.length > 0) {
        const list = conflicts.map((c) => `${c.webex_space_id}→team ${c.team_id}`).join(", ");
        throw new ApiError(
          `Space(s) already mapped to a different team: ${list}. Remove them from that team first.`,
          409
        );
      }
    }

    const now = new Date();
    const nextSpaceIds = new Set(next.map((s) => s.webex_space_id));

    const previousMappings = await teamCol
      .find({ team_id: teamIdStr, active: { $ne: false } } as never)
      .toArray();
    const removedSpaceIds = previousMappings
      .filter((m) => !nextSpaceIds.has(m.webex_space_id))
      .map((m) => m.webex_space_id);

    if (removedSpaceIds.length > 0) {
      await teamCol.updateMany(
        { webex_space_id: { $in: removedSpaceIds }, team_id: teamIdStr } as never,
        { $set: { active: false, updated_at: now } }
      );
    }

    for (const s of next) {
      await teamCol.updateOne(
        { webex_space_id: s.webex_space_id, team_id: teamIdStr } as never,
        {
          $set: {
            webex_space_id: s.webex_space_id,
            team_id: teamIdStr,
            space_name: s.space_name,
            webex_workspace_id: webexWorkspaceRef(s.webex_workspace_id),
            active: true,
            updated_at: now,
          },
          $setOnInsert: {
            created_by: user.email,
            created_at: now,
          },
        },
        { upsert: true }
      );
    }

    await teamsCol.updateOne(
      { _id: teamId } as never,
      {
        $set: {
          webex_spaces: next.map((s) => ({
            space_id: s.webex_space_id,
            space_name: s.space_name,
            workspace_id: webexWorkspaceRef(s.webex_workspace_id),
          })),
          updated_at: now,
        },
      }
    );

    console.log(
      `[Admin TeamWebexSpaces] PUT team=${teamIdStr} spaces=${next.length} removed=${removedSpaceIds.length} by=${user.email}`
    );

    return successResponse({
      team_id: teamIdStr,
      spaces: next,
      removed_space_ids: removedSpaceIds,
    });
  }
);
