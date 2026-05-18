import { NextRequest } from "next/server";
import type { Document } from "mongodb";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { slackWorkspaceRef } from "@/lib/rbac/slack-channel-grant-store";
import { slackChannelGrantRelationship } from "@/lib/rbac/slack-channel-rebac";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";

import { withSlackChannelRebacManageAuth, withSlackChannelRebacViewAuth } from "../_lib";

interface SlackMigrationDefaultsRequest {
  team_slug?: unknown;
  agent_id?: unknown;
  create_routes?: unknown;
}

export const GET = withErrorHandler(async (request: NextRequest) =>
  withSlackChannelRebacViewAuth(request, async () =>
    successResponse({
      defaults: {
        team_slug: process.env.SLACK_DEFAULT_TEAM_SLUG?.trim() || "",
        agent_id: process.env.SLACK_DEFAULT_AGENT_ID?.trim() || "",
        create_routes: true,
      },
    })
  )
);

interface ChannelTeamMappingDoc extends Document {
  slack_workspace_id?: string;
  slack_channel_id: string;
  channel_name?: string;
  team_id?: string;
  team_slug?: string;
  active?: boolean;
}

interface TeamDoc extends Document {
  _id: unknown;
  slug?: string;
  name?: string;
  resources?: {
    agents?: string[];
    [key: string]: unknown;
  };
}

interface DynamicAgentDoc extends Document {
  _id: string;
  name?: string;
  enabled?: boolean;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(`${field} is required`, 400);
  }
  return value.trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export const POST = withErrorHandler(async (request: NextRequest) =>
  withSlackChannelRebacManageAuth(request, async () => {
    const body = (await request.json()) as SlackMigrationDefaultsRequest;
    const teamSlug = readRequiredString(body.team_slug, "team_slug");
    const agentId = readRequiredString(body.agent_id, "agent_id");
    const createRoutes = Boolean(body.create_routes);
    const actor = "api";
    const now = new Date().toISOString();

    const [teams, agents, mappings, grants, routes] = await Promise.all([
      getCollection<TeamDoc>("teams"),
      getCollection<DynamicAgentDoc>("dynamic_agents"),
      getCollection<ChannelTeamMappingDoc>("channel_team_mappings"),
      getCollection("slack_channel_grants"),
      getCollection("slack_channel_agent_routes"),
    ]);

    const [team, agent, channels] = await Promise.all([
      teams.findOne({ slug: teamSlug } as never),
      agents.findOne({ _id: agentId, enabled: { $ne: false } } as never),
      mappings.find({ active: { $ne: false } } as never).sort({ channel_name: 1 }).limit(500).toArray(),
    ]);

    if (!team) {
      throw new ApiError(`Default team "${teamSlug}" was not found`, 404);
    }
    if (!agent) {
      throw new ApiError(`Default Dynamic Agent "${agentId}" was not found or is disabled`, 404);
    }
    if (channels.length === 0) {
      throw new ApiError("No onboarded Slack channels found", 400);
    }

    let channelsAssignedTeam = 0;
    for (const channel of channels) {
      if (channel.team_slug) continue;
      channelsAssignedTeam += 1;
      await mappings.updateOne(
        { slack_channel_id: channel.slack_channel_id } as never,
        {
          $set: {
            team_id: String(team._id),
            team_slug: teamSlug,
            updated_by: actor,
            updated_at: now,
          },
        } as never
      );
    }

    const teamResources = team.resources ?? {};
    const nextTeamAgents = uniqueStrings([...(teamResources.agents ?? []), agentId]);
    await teams.updateOne(
      { _id: team._id } as never,
      {
        $set: {
          resources: { ...teamResources, agents: nextTeamAgents },
          updated_by: actor,
          updated_at: now,
        },
      } as never
    );

    for (const channel of channels) {
      const workspaceId = slackWorkspaceRef(channel.slack_workspace_id);
      await grants.updateOne(
        {
          workspace_id: workspaceId,
          channel_id: channel.slack_channel_id,
          "resource.type": "agent",
          "resource.id": agentId,
        },
        {
          $set: {
            workspace_id: workspaceId,
            channel_id: channel.slack_channel_id,
            resource: { type: "agent", id: agentId },
            actions: ["use"],
            source_type: "migration",
            status: "active",
            created_by: actor,
            created_at: now,
            updated_by: actor,
            updated_at: now,
          },
        },
        { upsert: true }
      );

      if (createRoutes) {
        await routes.updateOne(
          {
            workspace_id: workspaceId,
            channel_id: channel.slack_channel_id,
            agent_id: agentId,
          },
          {
            $set: {
              workspace_id: workspaceId,
              channel_id: channel.slack_channel_id,
              agent_id: agentId,
              enabled: true,
              priority: 100,
              users: { enabled: true, listen: "mention" },
              source_type: "bootstrap",
              status: "active",
              created_by: actor,
              created_at: now,
              updated_by: actor,
              updated_at: now,
            },
          },
          { upsert: true }
        );
      }
    }

    const writes: UniversalRebacRelationship[] = [
      ...channels.map((channel) =>
        slackChannelGrantRelationship(
          slackWorkspaceRef(channel.slack_workspace_id),
          channel.slack_channel_id,
          { type: "agent", id: agentId },
          "use"
        )
      ),
      {
        subject: { type: "team", id: teamSlug, relation: "member" },
        action: "use",
        resource: { type: "agent", id: agentId },
      },
    ];

    const openfga = await writeOpenFgaTuples(buildUniversalRebacTupleDiff({ writes, deletes: [] })).catch(
      (error) => ({
        enabled: false,
        writes: 0,
        deletes: 0,
        error: error instanceof Error ? error.message : "OpenFGA tuple write failed",
      })
    );

    return successResponse({
      summary: {
        channels_seen: channels.length,
        channels_assigned_team: channelsAssignedTeam,
        channel_grants_ensured: channels.length,
        routes_ensured: createRoutes ? channels.length : 0,
        team_grant_ensured: true,
      },
      defaults: {
        team_slug: teamSlug,
        team_id: String(team._id),
        agent_id: agentId,
      },
      openfga,
    });
  })
);
