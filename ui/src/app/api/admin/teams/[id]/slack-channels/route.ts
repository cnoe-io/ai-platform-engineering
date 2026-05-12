/**
 * Spec 098 US9 — Team-scoped Slack channel assignment.
 *
 * GET  /api/admin/teams/[id]/slack-channels
 *   Returns the channels currently assigned to the team plus the catalog of
 *   agents the team can bind a channel to (sourced from `team.resources.agents`
 *   so we don't accidentally let admins bind a channel to an agent the team
 *   doesn't otherwise have access to).
 *
 * PUT  /api/admin/teams/[id]/slack-channels
 *   body: { channels: Array<{ slack_channel_id, channel_name, slack_workspace_id?, bound_agent_id? }> }
 *
 *   Idempotent full-replace. We persist into TWO collections so the existing
 *   Slack-bot reader code (`channel_team_mappings` + `channel_agent_mappings`)
 *   keeps working unchanged:
 *
 *     channel_team_mappings   — channel → team (gates which team's RBAC applies)
 *     channel_agent_mappings  — channel → agent (which agent answers in-channel)
 *
 *   Channels that were previously assigned to *this* team but not present in
 *   the new payload are deactivated (`active: false`) — but only if their
 *   `team_id` still points at this team. We don't touch mappings owned by
 *   other teams (defence against double-assignment races).
 *
 *   We also denormalise a thin `slack_channels` array onto the team document
 *   so the team-card StatChip can show a count without an extra round-trip.
 */

import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireAdmin,
  requireRbacPermission,
  ApiError,
} from "@/lib/api-middleware";
import type { Team } from "@/types/teams";

interface ChannelTeamMappingDoc {
  _id?: ObjectId;
  slack_channel_id: string;
  team_id: string;
  channel_name?: string;
  slack_workspace_id?: string;
  active?: boolean;
  created_by?: string;
  created_at?: Date;
  updated_at?: Date;
}

interface ChannelAgentMappingDoc {
  _id?: ObjectId;
  slack_channel_id: string;
  agent_id: string;
  slack_workspace_id?: string;
  channel_name?: string;
  created_by?: string;
  created_at?: Date;
  active?: boolean;
}

interface DynamicAgentLite {
  _id: string;
  name?: string;
  description?: string;
}

interface SlackChannelInput {
  slack_channel_id: string;
  channel_name: string;
  slack_workspace_id?: string;
  bound_agent_id?: string | null;
}

function requireMongoDB() {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: "MongoDB not configured - team slack channel mappings require MongoDB",
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

// Slack channel IDs are uppercase alphanumeric, ≥9 chars, prefixed with C/G/D.
// Validation here is conservative — admins paste IDs straight from Slack so
// a typo is the most common error and worth catching server-side.
const SLACK_CHANNEL_ID_RE = /^[CGD][A-Z0-9]{8,}$/;

function parseChannelInput(value: unknown, idx: number): SlackChannelInput {
  if (!value || typeof value !== "object") {
    throw new ApiError(`channels[${idx}] must be an object`, 400);
  }
  const v = value as Record<string, unknown>;

  const slackChannelId = typeof v.slack_channel_id === "string" ? v.slack_channel_id.trim() : "";
  if (!slackChannelId) {
    throw new ApiError(`channels[${idx}].slack_channel_id is required`, 400);
  }
  if (!SLACK_CHANNEL_ID_RE.test(slackChannelId)) {
    throw new ApiError(
      `channels[${idx}].slack_channel_id "${slackChannelId}" doesn't look like a Slack channel ID (expected e.g. C0ASAQMEZ4M)`,
      400
    );
  }

  const channelName =
    typeof v.channel_name === "string" && v.channel_name.trim()
      ? v.channel_name.trim()
      : slackChannelId;

  const workspaceId =
    typeof v.slack_workspace_id === "string" && v.slack_workspace_id.trim()
      ? v.slack_workspace_id.trim()
      : "unknown";

  let boundAgentId: string | null = null;
  if (typeof v.bound_agent_id === "string" && v.bound_agent_id.trim()) {
    boundAgentId = v.bound_agent_id.trim();
  }

  return {
    slack_channel_id: slackChannelId,
    channel_name: channelName,
    slack_workspace_id: workspaceId,
    bound_agent_id: boundAgentId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — current assignments + catalog of bindable agents
// ─────────────────────────────────────────────────────────────────────────────

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    return withAuth(request, async (_req, user, session) => {
      await requireRbacPermission(session, "admin_ui", "view");

      const { id } = await context.params;
      const teamId = parseTeamId(id);
      const teamIdStr = id;

      const teamsCol = await getCollection<Team>("teams");
      const team = await teamsCol.findOne({ _id: teamId } as never);
      if (!team) throw new ApiError("Team not found", 404);

      const teamCol = await getCollection<ChannelTeamMappingDoc>("channel_team_mappings");
      const agentCol = await getCollection<ChannelAgentMappingDoc>("channel_agent_mappings");
      const dynAgentsCol = await getCollection<DynamicAgentLite>("dynamic_agents");

      const teamMappings = await teamCol
        .find({ team_id: teamIdStr, active: { $ne: false } } as never)
        .sort({ channel_name: 1 })
        .toArray();

      // Fetch the matching agent bindings in one query.
      const channelIds = teamMappings.map((m) => m.slack_channel_id);
      const agentMappings =
        channelIds.length > 0
          ? await agentCol
              .find({ slack_channel_id: { $in: channelIds }, active: { $ne: false } } as never)
              .toArray()
          : [];
      const agentByChannel = new Map<string, string>();
      for (const am of agentMappings) {
        agentByChannel.set(am.slack_channel_id, am.agent_id);
      }

      // Catalog of agents the team can bind (only agents this team has
      // `agent_user:<id>` for — otherwise binding the channel would
      // immediately fail authz when the bot tried to call the agent).
      const allowedAgentIds = team.resources?.agents ?? [];
      const allowedAgentDocs =
        allowedAgentIds.length > 0
          ? await dynAgentsCol
              .find({ _id: { $in: allowedAgentIds } } as never, {
                projection: { _id: 1, name: 1, description: 1 },
              })
              .toArray()
              .catch(() => [] as DynamicAgentLite[])
          : [];

      const channels = teamMappings.map((m) => ({
        slack_channel_id: m.slack_channel_id,
        channel_name: m.channel_name ?? m.slack_channel_id,
        slack_workspace_id: m.slack_workspace_id ?? "unknown",
        bound_agent_id: agentByChannel.get(m.slack_channel_id) ?? null,
      }));

      console.log(
        `[Admin TeamSlackChannels] GET team=${teamIdStr} channels=${channels.length} bindable_agents=${allowedAgentDocs.length} by=${user.email}`
      );

      return successResponse({
        team_id: teamIdStr,
        channels,
        available_agents: allowedAgentDocs.map((a) => ({
          id: a._id,
          name: a.name ?? a._id,
          description: a.description ?? "",
        })),
      });
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT — full replace of this team's channel assignments
// ─────────────────────────────────────────────────────────────────────────────

interface PutBody {
  channels?: unknown;
}

export const PUT = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    return withAuth(request, async (_req, user, session) => {
      await requireRbacPermission(session, "admin_ui", "admin");
      requireAdmin(session);

      const { id } = await context.params;
      const teamId = parseTeamId(id);
      const teamIdStr = id;

      let body: PutBody;
      try {
        body = (await request.json()) as PutBody;
      } catch {
        throw new ApiError("Invalid JSON body", 400);
      }

      if (!Array.isArray(body.channels)) {
        throw new ApiError("channels must be an array", 400);
      }

      const inputs: SlackChannelInput[] = body.channels.map((c, i) => parseChannelInput(c, i));

      // Dedup by channel ID (last write wins) so an admin can't accidentally
      // submit the same channel twice with conflicting agent bindings.
      const byChannel = new Map<string, SlackChannelInput>();
      for (const c of inputs) byChannel.set(c.slack_channel_id, c);
      const next = Array.from(byChannel.values());

      const teamsCol = await getCollection<Team>("teams");
      const team = await teamsCol.findOne({ _id: teamId } as never);
      if (!team) throw new ApiError("Team not found", 404);

      // Validate every bound_agent_id is in this team's agent allowlist.
      // (Empty/null is fine — that's a "team-scoped channel with no default
      // agent", which is still useful: the channel inherits team RBAC but the
      // user invokes an agent explicitly via supervisor/`@agent`.)
      const allowedAgents = new Set(team.resources?.agents ?? []);
      for (const c of next) {
        if (c.bound_agent_id && !allowedAgents.has(c.bound_agent_id)) {
          throw new ApiError(
            `bound_agent_id "${c.bound_agent_id}" for channel ${c.slack_channel_id} is not in this team's assigned agents. Add it via the Resources tab first.`,
            400
          );
        }
      }

      const teamCol = await getCollection<ChannelTeamMappingDoc>("channel_team_mappings");
      const agentCol = await getCollection<ChannelAgentMappingDoc>("channel_agent_mappings");

      // Defence against double-assignment: a channel can only belong to one
      // team. Reject if any of the new channel IDs are already actively
      // mapped to a different team.
      const conflictingChannelIds = next.map((c) => c.slack_channel_id);
      if (conflictingChannelIds.length > 0) {
        const conflicts = await teamCol
          .find({
            slack_channel_id: { $in: conflictingChannelIds },
            team_id: { $ne: teamIdStr },
            active: { $ne: false },
          } as never)
          .toArray();
        if (conflicts.length > 0) {
          const list = conflicts
            .map((c) => `${c.slack_channel_id}→team ${c.team_id}`)
            .join(", ");
          throw new ApiError(
            `Channel(s) already mapped to a different team: ${list}. Remove them from that team first.`,
            409
          );
        }
      }

      const now = new Date();
      const nextChannelIds = new Set(next.map((c) => c.slack_channel_id));

      // ── 1. Deactivate channels that were previously this team's but are no
      //       longer in the payload. We `$ne` filter on team_id so we never
      //       touch another team's mappings.
      const previousMappings = await teamCol
        .find({ team_id: teamIdStr, active: { $ne: false } } as never)
        .toArray();
      const removedChannelIds = previousMappings
        .filter((m) => !nextChannelIds.has(m.slack_channel_id))
        .map((m) => m.slack_channel_id);

      if (removedChannelIds.length > 0) {
        await teamCol.updateMany(
          { slack_channel_id: { $in: removedChannelIds }, team_id: teamIdStr } as never,
          { $set: { active: false, updated_at: now } }
        );
        await agentCol.updateMany(
          { slack_channel_id: { $in: removedChannelIds } } as never,
          { $set: { active: false } }
        );
      }

      // ── 2. Upsert the active set.
      for (const c of next) {
        await teamCol.updateOne(
          { slack_channel_id: c.slack_channel_id } as never,
          {
            $set: {
              slack_channel_id: c.slack_channel_id,
              team_id: teamIdStr,
              channel_name: c.channel_name,
              slack_workspace_id: c.slack_workspace_id ?? "unknown",
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

        if (c.bound_agent_id) {
          await agentCol.updateOne(
            { slack_channel_id: c.slack_channel_id } as never,
            {
              $set: {
                slack_channel_id: c.slack_channel_id,
                agent_id: c.bound_agent_id,
                slack_workspace_id: c.slack_workspace_id ?? "unknown",
                channel_name: c.channel_name,
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
        } else {
          // No bound agent → deactivate any existing agent mapping for this
          // channel so the bot falls back to its default routing logic.
          await agentCol.updateMany(
            { slack_channel_id: c.slack_channel_id, active: { $ne: false } } as never,
            { $set: { active: false } }
          );
        }
      }

      // ── 3. Denormalise count onto team document.
      await teamsCol.updateOne(
        { _id: teamId } as never,
        {
          $set: {
            slack_channels: next.map((c) => ({
              slack_channel_id: c.slack_channel_id,
              channel_name: c.channel_name,
              slack_workspace_id: c.slack_workspace_id ?? "unknown",
              bound_agent_id: c.bound_agent_id ?? null,
            })),
            updated_at: now,
          },
        }
      );

      console.log(
        `[Admin TeamSlackChannels] PUT team=${teamIdStr} channels=${next.length} removed=${removedChannelIds.length} by=${user.email}`
      );

      return successResponse({
        team_id: teamIdStr,
        channels: next,
        removed_channel_ids: removedChannelIds,
      });
    });
  }
);
