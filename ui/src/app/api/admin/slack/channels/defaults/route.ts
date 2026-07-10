import type { Document } from "mongodb";
import { NextRequest } from "next/server";

import {
ApiError,
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { ensureSlackBotOboPermissions } from "@/lib/rbac/keycloak-admin";
import {
OnboardingDefaultsValidationError,
readOnboardingDefaults,
writeOnboardingDefaults,
} from "@/lib/rbac/onboarding-defaults";
import { writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { slackWorkspaceRef } from "@/lib/rbac/slack-channel-grant-store";
import {
slackChannelGrantRelationship,
slackChannelTeamVisibilityRelationships,
} from "@/lib/rbac/slack-channel-rebac";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
import { callSlackBotAdmin } from "@/lib/slack-bot-admin";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";

import { withSlackChannelRebacManageAuth,withSlackChannelRebacViewAuth } from "../_lib";

interface SlackMigrationDefaultsRequest {
  team_slug?: unknown;
  agent_id?: unknown;
  create_routes?: unknown;
  discovered_channels?: unknown;
  channel_defaults?: unknown;
}

export const GET = withErrorHandler(async (request: NextRequest) =>
  withSlackChannelRebacViewAuth(request, async () => {
    // DB-first read so admin's saved picks survive a page reload.
    // Falls back to legacy env vars (`SLACK_DEFAULT_TEAM_SLUG`,
    // `SLACK_DEFAULT_AGENT_ID`) when nothing has been saved yet, which
    // keeps fresh installs / compose bootstrap behaviour intact.
    const defaults = await readOnboardingDefaults("slack");
    return successResponse({ defaults });
  }),
);

/**
 * PUT — save the onboarding defaults without running the migration
 * pipeline. The migration POST (below) remains unchanged for callers
 * that want the old "save + onboard everything" behaviour, but the
 * Admin UI now uses PUT for its dedicated "Save defaults" button.
 */
export const PUT = withErrorHandler(async (request: NextRequest) =>
  withSlackChannelRebacManageAuth(request, async () => {
    const { session } = await getAuthFromBearerOrSession(request);
    const body = (await request.json().catch(() => ({}))) as SlackMigrationDefaultsRequest;
    const teamSlug = readOptionalString(body.team_slug);
    const agentId = readOptionalString(body.agent_id);
    const createRoutes =
      typeof body.create_routes === "boolean" ? body.create_routes : true;

    try {
      const saved = await writeOnboardingDefaults("slack", {
        team_slug: teamSlug,
        agent_id: agentId,
        create_routes: createRoutes,
        actor: session?.user?.email ?? "api",
      });
      return successResponse({ defaults: saved });
    } catch (error) {
      if (error instanceof OnboardingDefaultsValidationError) {
        throw new ApiError(error.message, 400);
      }
      throw error;
    }
  }),
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
}

interface DynamicAgentDoc extends Document {
  _id: string;
  name?: string;
  enabled?: boolean;
}

interface SlackChannelGrantDoc extends Document {
  workspace_id: string;
  channel_id: string;
  resource?: {
    type?: string;
    id?: string;
  };
  status?: string;
}

interface DiscoveredSlackChannel {
  workspace_id: string;
  channel_id: string;
  channel_name: string;
}

interface SlackChannelImportDefault extends DiscoveredSlackChannel {
  team_slug: string;
  agent_id: string;
}

interface SlackRuntimeReloadResult {
  attempted: boolean;
  ok: boolean;
  result?: unknown;
  error?: string;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(`${field} is required`, 400);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeDiscoveredChannels(value: unknown): DiscoveredSlackChannel[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ApiError("discovered_channels must be an array", 400);
  }

  const byKey = new Map<string, DiscoveredSlackChannel>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const channelId = readOptionalString(record.id) || readOptionalString(record.channel_id);
    if (!channelId) continue;
    const workspaceId = slackWorkspaceRef(readOptionalString(record.workspace_id));
    const channelName =
      readOptionalString(record.name) || readOptionalString(record.channel_name) || channelId;
    byKey.set(`${workspaceId}/${channelId}`, {
      workspace_id: workspaceId,
      channel_id: channelId,
      channel_name: channelName,
    });
  }
  return Array.from(byKey.values());
}

function normalizeChannelDefaults(
  value: unknown,
  fallbackTeamSlug: string,
  fallbackAgentId: string
): SlackChannelImportDefault[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ApiError("channel_defaults must be an array", 400);
  }

  const byKey = new Map<string, SlackChannelImportDefault>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const channelId = readOptionalString(record.id) || readOptionalString(record.channel_id);
    if (!channelId) continue;
    const workspaceId = slackWorkspaceRef(readOptionalString(record.workspace_id));
    const channelName =
      readOptionalString(record.name) || readOptionalString(record.channel_name) || channelId;
    const teamSlug = readOptionalString(record.team_slug) || fallbackTeamSlug;
    const agentId = readOptionalString(record.agent_id) || fallbackAgentId;
    byKey.set(`${workspaceId}/${channelId}`, {
      workspace_id: workspaceId,
      channel_id: channelId,
      channel_name: channelName,
      team_slug: teamSlug,
      agent_id: agentId,
    });
  }
  return Array.from(byKey.values());
}

async function reloadSlackRuntime(): Promise<SlackRuntimeReloadResult> {
  try {
    const result = await callSlackBotAdmin("/admin/slack/routes/reload", {
      method: "POST",
      body: {},
    });
    return { attempted: true, ok: true, result };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : "Slack bot runtime reload failed",
    };
  }
}

export const POST = withErrorHandler(async (request: NextRequest) =>
  withSlackChannelRebacManageAuth(request, async () => {
    const body = (await request.json()) as SlackMigrationDefaultsRequest;
    const teamSlug = readRequiredString(body.team_slug, "team_slug");
    const agentId = readRequiredString(body.agent_id, "agent_id");
    const createRoutes = Boolean(body.create_routes);
    const discoveredChannels = normalizeDiscoveredChannels(body.discovered_channels);
    const explicitChannelDefaults = normalizeChannelDefaults(
      body.channel_defaults,
      teamSlug,
      agentId
    );
    const channelDefaults =
      explicitChannelDefaults.length > 0
        ? explicitChannelDefaults
        : discoveredChannels.map((channel) => ({
            ...channel,
            team_slug: teamSlug,
            agent_id: agentId,
          }));
    const hasChannelScopedDefaults = channelDefaults.length > 0;
    const actor = "api";
    const now = new Date().toISOString();

    const [teams, agents, mappings, grants, routes] = await Promise.all([
      getCollection<TeamDoc>("teams"),
      getCollection<DynamicAgentDoc>("dynamic_agents"),
      getCollection<ChannelTeamMappingDoc>("channel_team_mappings"),
      getCollection<SlackChannelGrantDoc>("slack_channel_grants"),
      getCollection("slack_channel_agent_routes"),
    ]);

    const requestedTeamSlugs = uniqueStrings([
      teamSlug,
      ...channelDefaults.map((channelDefault) => channelDefault.team_slug),
    ]);
    const requestedAgentIds = uniqueStrings([
      agentId,
      ...channelDefaults.map((channelDefault) => channelDefault.agent_id),
    ]);
    const [requestedTeams, requestedAgents] = await Promise.all([
      teams.find({ slug: { $in: requestedTeamSlugs } } as never).toArray(),
      agents.find({ _id: { $in: requestedAgentIds }, enabled: { $ne: false } } as never).toArray(),
    ]);
    const teamBySlug = new Map(requestedTeams.map((team) => [team.slug, team]));
    const agentById = new Map(requestedAgents.map((agent) => [agent._id, agent]));
    const team = teamBySlug.get(teamSlug);
    const agent = agentById.get(agentId);

    if (!team) {
      throw new ApiError(`Default team "${teamSlug}" was not found`, 404);
    }
    if (!agent) {
      throw new ApiError(`Default Dynamic Agent "${agentId}" was not found or is disabled`, 404);
    }
    for (const channelDefault of channelDefaults) {
      if (!teamBySlug.has(channelDefault.team_slug)) {
        throw new ApiError(`Team "${channelDefault.team_slug}" was not found`, 404);
      }
      if (!agentById.has(channelDefault.agent_id)) {
        throw new ApiError(
          `Dynamic Agent "${channelDefault.agent_id}" was not found or is disabled`,
          404
        );
      }
    }

    // Phase 3 (spec 2026-05-24-derive-team-from-channel): the Slack bot
    // no longer needs a per-team OBO client scope materialized in Keycloak
    // because team identity is derived from the channel→team mapping at
    // message time. We still ensure the bot's general OBO permissions are
    // in place — the rest of the legacy team-scope wiring is gone.
    try {
      await ensureSlackBotOboPermissions();
    } catch (error) {
      console.error("[Slack ReBAC] Failed to prepare Slack bot OBO permissions:", error);
      throw new ApiError(
        "We couldn't finish preparing Slack access for this team. Open Security & Policy, " +
          "run Reconcile now, then try setting up the channel again.",
        502
      );
    }
    // `hasChannelScopedDefaults` is still computed above to drive the per-channel
    // mapping loop below; the value no longer influences Keycloak.
    void hasChannelScopedDefaults;

    let channelsOnboarded = 0;
    let channelsAssignedTeam = 0;
    for (const channel of channelDefaults) {
      const channelTeam = teamBySlug.get(channel.team_slug);
      const result = await mappings.updateOne(
        {
          slack_workspace_id: channel.workspace_id,
          slack_channel_id: channel.channel_id,
        } as never,
        {
          $set: {
            channel_name: channel.channel_name,
            ...(channelTeam
              ? {
                  team_id: String(channelTeam._id),
                  team_slug: channel.team_slug,
                }
              : {}),
            active: true,
            updated_by: actor,
            updated_at: now,
          },
          $setOnInsert: {
            slack_workspace_id: channel.workspace_id,
            slack_channel_id: channel.channel_id,
            created_by: actor,
            created_at: now,
          },
        } as never,
        { upsert: true }
      );
      channelsOnboarded += result.upsertedCount ?? 0;
      channelsAssignedTeam += 1;
    }

    const activeChannels = await mappings
      .find({ active: { $ne: false } } as never)
      .sort({ channel_name: 1 })
      .limit(500)
      .toArray();
    const channelDefaultByKey = new Map(
      channelDefaults.map((channelDefault) => [
        `${slackWorkspaceRef(channelDefault.workspace_id)}/${channelDefault.channel_id}`,
        channelDefault,
      ])
    );
    const channels = hasChannelScopedDefaults
      ? activeChannels.filter((channel) =>
          channelDefaultByKey.has(
            `${slackWorkspaceRef(channel.slack_workspace_id)}/${channel.slack_channel_id}`
          )
        )
      : activeChannels;

    if (channels.length === 0) {
      throw new ApiError("No onboarded Slack channels found", 400);
    }

    let routesEnsured = 0;
    let routesPreserved = 0;
    let channelGrantsReplaced = 0;
    let routesReplaced = 0;
    const deleteRelationships: UniversalRebacRelationship[] = [];
    if (!hasChannelScopedDefaults) {
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
    }

    const teamAgentPairs = new Map<string, { team: TeamDoc; agent_id: string }>();
    if (hasChannelScopedDefaults) {
      for (const channelDefault of channelDefaults) {
        const targetTeam = teamBySlug.get(channelDefault.team_slug);
        if (targetTeam) {
          teamAgentPairs.set(`${channelDefault.team_slug}/${channelDefault.agent_id}`, {
            team: targetTeam,
            agent_id: channelDefault.agent_id,
          });
        }
      }
    } else {
      teamAgentPairs.set(`${teamSlug}/${agentId}`, { team, agent_id: agentId });
    }
    // The team→agent grant is written to OpenFGA below (the canonical
    // `team:<slug>#member use agent:<id>` tuple in `writes`), which is the
    // single source of truth for team↔resource access.

    for (const channel of channels) {
      const workspaceId = slackWorkspaceRef(channel.slack_workspace_id);
      const scopedDefault = channelDefaultByKey.get(`${workspaceId}/${channel.slack_channel_id}`);
      const targetAgentId = scopedDefault?.agent_id ?? agentId;
      if (hasChannelScopedDefaults) {
        const staleGrants = await grants
          .find({
            workspace_id: workspaceId,
            channel_id: channel.slack_channel_id,
            "resource.type": "agent",
            "resource.id": { $ne: targetAgentId },
            status: "active",
          } as never)
          .toArray();
        channelGrantsReplaced += staleGrants.length;
        for (const staleGrant of staleGrants) {
          const staleAgentId = staleGrant.resource?.id;
          if (!staleAgentId) continue;
          deleteRelationships.push(
            slackChannelGrantRelationship(
              workspaceId,
              channel.slack_channel_id,
              { type: "agent", id: staleAgentId },
              "use"
            )
          );
        }
        if (staleGrants.length > 0) {
          await grants.updateMany(
            {
              workspace_id: workspaceId,
              channel_id: channel.slack_channel_id,
              "resource.type": "agent",
              "resource.id": { $ne: targetAgentId },
              status: "active",
            } as never,
            {
              $set: {
                status: "deleted",
                updated_by: actor,
                updated_at: now,
              },
            } as never
          );
        }
      }
      await grants.updateOne(
        {
          workspace_id: workspaceId,
          channel_id: channel.slack_channel_id,
          "resource.type": "agent",
          "resource.id": targetAgentId,
        },
        {
          $set: {
            workspace_id: workspaceId,
            channel_id: channel.slack_channel_id,
            resource: { type: "agent", id: targetAgentId },
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
        const workspaceId = slackWorkspaceRef(channel.slack_workspace_id);
        if (hasChannelScopedDefaults) {
          const staleRoutes = await routes
            .find({
              workspace_id: workspaceId,
              channel_id: channel.slack_channel_id,
              agent_id: { $ne: targetAgentId },
              status: "active",
            } as never)
            .toArray();
          routesReplaced += staleRoutes.length;
          if (staleRoutes.length > 0) {
            await routes.updateMany(
              {
                workspace_id: workspaceId,
                channel_id: channel.slack_channel_id,
                agent_id: { $ne: targetAgentId },
                status: "active",
              } as never,
              {
                $set: {
                  enabled: false,
                  status: "deleted",
                  updated_by: actor,
                  updated_at: now,
                },
              } as never
            );
          }
        }
        const existingRoute = await routes.findOne({
          workspace_id: workspaceId,
          channel_id: channel.slack_channel_id,
          agent_id: targetAgentId,
          status: { $ne: "deleted" },
        } as never);
        if (existingRoute) {
          routesPreserved += 1;
          continue;
        }
        await routes.updateOne(
          {
            workspace_id: slackWorkspaceRef(channel.slack_workspace_id),
            channel_id: channel.slack_channel_id,
            agent_id: targetAgentId,
          },
          {
            $set: {
              workspace_id: workspaceId,
              channel_id: channel.slack_channel_id,
              agent_id: targetAgentId,
              enabled: true,
              priority: 100,
              // Admin explicitly ran "Setup Slack channel association" for this
              // channel, which is itself the opt-in signal — but default to
              // mention-only so the bot doesn't respond to every plain
              // channel message. Admins can widen to "all" later via the
              // Step-2a route picker.
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
        routesEnsured += 1;
      }
    }

    const writes: UniversalRebacRelationship[] = [
      ...channels.flatMap((channel): UniversalRebacRelationship[] => {
        const workspaceId = slackWorkspaceRef(channel.slack_workspace_id);
        const scopedDefault = channelDefaultByKey.get(`${workspaceId}/${channel.slack_channel_id}`);
        const channelToAgent = slackChannelGrantRelationship(
          workspaceId,
          channel.slack_channel_id,
          { type: "agent", id: scopedDefault?.agent_id ?? agentId },
          "use"
        );
        // Inbound team→channel visibility. Without these, the admin
        // /api/admin/slack/channels listing route filters this channel out
        // because no user can `can_read` the channel object in OpenFGA.
        const targetTeamSlug = scopedDefault?.team_slug ?? channel.team_slug;
        const teamVisibility = targetTeamSlug
          ? slackChannelTeamVisibilityRelationships(
              workspaceId,
              channel.slack_channel_id,
              String(targetTeamSlug)
            )
          : [];
        return [channelToAgent, ...teamVisibility];
      }),
      ...Array.from(teamAgentPairs.values()).map(
        ({ team: targetTeam, agent_id: targetAgentId }): UniversalRebacRelationship => ({
          subject: { type: "team", id: String(targetTeam.slug), relation: "member" },
          action: "use",
          resource: { type: "agent", id: targetAgentId },
        })
      ),
    ];

    const openfga = await writeOpenFgaTuples(
      buildUniversalRebacTupleDiff({ writes, deletes: deleteRelationships })
    ).catch((error) => ({
      enabled: false,
      writes: 0,
      deletes: 0,
      error: error instanceof Error ? error.message : "OpenFGA tuple write failed",
    }));

    const runtimeReload = await reloadSlackRuntime();

    return successResponse({
      summary: {
        channels_seen: channels.length,
        channels_discovered: channelDefaults.length,
        channels_onboarded: channelsOnboarded,
        channels_assigned_team: channelsAssignedTeam,
        channel_grants_ensured: channels.length,
        channel_grants_replaced: channelGrantsReplaced,
        routes_ensured: routesEnsured,
        routes_preserved: routesPreserved,
        routes_replaced: routesReplaced,
        team_grant_ensured: true,
      },
      defaults: {
        team_slug: teamSlug,
        team_id: String(team._id),
        agent_id: agentId,
      },
      openfga,
      runtime_reload: runtimeReload,
    });
  })
);
