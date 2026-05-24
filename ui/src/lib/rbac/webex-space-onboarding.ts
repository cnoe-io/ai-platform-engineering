import type { Document } from "mongodb";

import { ApiError } from "@/lib/api-error";
import { getCollection } from "@/lib/mongodb";
import {
  ensureTeamClientScope,
  ensureWebexBotOboPermissions,
  selectAgentGatewayActiveTeamScope,
} from "@/lib/rbac/keycloak-admin";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import { writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
import { webexWorkspaceRef } from "@/lib/rbac/webex-space-grant-store";
import {
  webexSpaceGrantRelationship,
  webexSpaceTeamVisibilityRelationships,
} from "@/lib/rbac/webex-space-rebac";
import { callWebexBotAdmin } from "@/lib/webex-bot-admin";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";
import type { WebexRouteListenMode } from "@/types/webex-rebac";

interface WebexSpaceTeamMappingDoc extends Document {
  webex_workspace_id?: string;
  webex_space_id: string;
  space_name?: string;
  space_title?: string;
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

export interface WebexSpaceOnboardingInput {
  workspace_id?: string;
  space_id: string;
  space_name?: string;
  team_slug: string;
  agent_id: string;
  listen?: WebexRouteListenMode;
  create_route?: boolean;
  dry_run?: boolean;
  actor?: string;
  reload_runtime?: boolean;
}

export interface WebexSpaceOnboardingResult {
  summary: {
    dry_run: boolean;
    spaces_seen: number;
    mappings_ensured: number;
    space_grants_ensured: number;
    routes_ensured: number;
    routes_preserved: number;
    team_grant_ensured: boolean;
  };
  space: {
    workspace_id: string;
    space_id: string;
    webex_room_id?: string;
    space_name: string;
    team_slug: string;
    team_id: string;
    agent_id: string;
    listen: WebexRouteListenMode;
  };
  openfga?: Awaited<ReturnType<typeof writeOpenFgaTuples>>;
  runtime_reload?: {
    attempted: boolean;
    ok: boolean;
    result?: unknown;
    error?: string;
  };
}

const WEBEX_ROOM_URI_PREFIX = "ciscospark://us/ROOM/";
const WEBEX_ROOM_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const WEBEX_SPACE_ID_RE = /^[a-zA-Z0-9._-]{8,128}$/;
const LISTEN_MODES = new Set<WebexRouteListenMode>(["message", "mention", "all"]);

function readRequiredString(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new ApiError(`${field} is required`, 400);
  }
  return trimmed;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function canonicalizeWebexSpaceId(spaceId: string): string {
  const trimmed = spaceId.trim();
  if (!trimmed) return trimmed;
  const padded = trimmed.padEnd(trimmed.length + ((4 - (trimmed.length % 4)) % 4), "=");
  try {
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    if (decoded.startsWith(WEBEX_ROOM_URI_PREFIX)) {
      const raw = decoded.slice(WEBEX_ROOM_URI_PREFIX.length);
      if (WEBEX_ROOM_UUID_RE.test(raw)) return raw;
    }
  } catch {
    // Non-public Webex IDs are already canonical for CAIPE.
  }
  return trimmed;
}

export function publicWebexRoomIdFromUuid(spaceId: string): string | undefined {
  const trimmed = spaceId.trim();
  if (!WEBEX_ROOM_UUID_RE.test(trimmed)) return undefined;
  return Buffer.from(`${WEBEX_ROOM_URI_PREFIX}${trimmed}`, "utf8").toString("base64").replace(/=+$/, "");
}

function parseListen(value: WebexRouteListenMode | undefined): WebexRouteListenMode {
  const listen = value ?? "all";
  if (!LISTEN_MODES.has(listen)) {
    throw new ApiError("listen must be one of message, mention, or all", 400);
  }
  return listen;
}

function assertSafeSpaceId(spaceId: string): void {
  if (!WEBEX_SPACE_ID_RE.test(spaceId)) {
    throw new ApiError("space_id must be a valid Webex space ID", 400);
  }
}

export async function onboardWebexSpace(
  input: WebexSpaceOnboardingInput
): Promise<WebexSpaceOnboardingResult> {
  const teamSlug = readRequiredString(input.team_slug, "team_slug");
  const agentId = readRequiredString(input.agent_id, "agent_id");
  const canonicalSpaceId = canonicalizeWebexSpaceId(readRequiredString(input.space_id, "space_id"));
  assertSafeSpaceId(canonicalSpaceId);
  const workspaceId = webexWorkspaceRef(input.workspace_id);
  const spaceName = input.space_name?.trim() || canonicalSpaceId;
  const listen = parseListen(input.listen);
  const createRoute = input.create_route !== false;
  const actor = input.actor?.trim() || "api";
  const dryRun = Boolean(input.dry_run);

  const [teams, agents] = await Promise.all([
    getCollection<TeamDoc>("teams"),
    getCollection<DynamicAgentDoc>("dynamic_agents"),
  ]);
  const [team, agent] = await Promise.all([
    teams.findOne({ slug: teamSlug } as never),
    agents.findOne({ _id: agentId, enabled: { $ne: false } } as never),
  ]);

  if (!team) {
    throw new ApiError(`Team "${teamSlug}" was not found`, 404);
  }
  if (!agent) {
    throw new ApiError(`Dynamic Agent "${agentId}" was not found or is disabled`, 404);
  }

  if (dryRun) {
    return {
      summary: {
        dry_run: true,
        spaces_seen: 1,
        mappings_ensured: 0,
        space_grants_ensured: 0,
        routes_ensured: 0,
        routes_preserved: 0,
        team_grant_ensured: false,
      },
      space: {
        workspace_id: workspaceId,
        space_id: canonicalSpaceId,
        ...(publicWebexRoomIdFromUuid(canonicalSpaceId)
          ? { webex_room_id: publicWebexRoomIdFromUuid(canonicalSpaceId) }
          : {}),
        space_name: spaceName,
        team_slug: teamSlug,
        team_id: String(team._id),
        agent_id: agentId,
        listen,
      },
      runtime_reload: { attempted: false, ok: true },
    };
  }

  await ensureTeamClientScope(teamSlug);
  await Promise.all([
    ensureWebexBotOboPermissions(),
    selectAgentGatewayActiveTeamScope(teamSlug),
  ]);

  const [mappings, grants, routes] = await Promise.all([
    getRbacCollection<WebexSpaceTeamMappingDoc>("webexSpaceTeamMappings"),
    getRbacCollection("webexSpaceGrants"),
    getRbacCollection("webexSpaceAgentRoutes"),
  ]);
  const now = new Date().toISOString();

  await mappings.updateOne(
    {
      webex_workspace_id: workspaceId,
      webex_space_id: canonicalSpaceId,
    } as never,
    {
      $set: {
        space_name: spaceName,
        space_title: spaceName,
        team_id: String(team._id),
        team_slug: teamSlug,
        active: true,
        updated_by: actor,
        updated_at: now,
      },
      $setOnInsert: {
        webex_workspace_id: workspaceId,
        webex_space_id: canonicalSpaceId,
        created_by: actor,
        created_at: now,
      },
    } as never,
    { upsert: true }
  );

  const teamResources = team.resources ?? {};
  await teams.updateOne(
    { _id: team._id } as never,
    {
      $set: {
        resources: {
          ...teamResources,
          agents: uniqueStrings([...(teamResources.agents ?? []), agentId]),
        },
        updated_by: actor,
        updated_at: now,
      },
    } as never
  );

  await grants.updateOne(
    {
      workspace_id: workspaceId,
      space_id: canonicalSpaceId,
      "resource.type": "agent",
      "resource.id": agentId,
    },
    {
      $set: {
        workspace_id: workspaceId,
        space_id: canonicalSpaceId,
        resource: { type: "agent", id: agentId },
        actions: ["use"],
        source_type: "bootstrap",
        status: "active",
        updated_by: actor,
        updated_at: now,
      },
      $setOnInsert: {
        created_by: actor,
        created_at: now,
      },
    },
    { upsert: true }
  );

  let routesEnsured = 0;
  let routesPreserved = 0;
  if (createRoute) {
    const existingRoute = await routes.findOne({
      workspace_id: workspaceId,
      space_id: canonicalSpaceId,
      agent_id: agentId,
      status: { $ne: "deleted" },
    } as never);
    if (existingRoute) {
      routesPreserved = 1;
    } else {
      await routes.updateOne(
        {
          workspace_id: workspaceId,
          space_id: canonicalSpaceId,
          agent_id: agentId,
        },
        {
          $set: {
            workspace_id: workspaceId,
            space_id: canonicalSpaceId,
            agent_id: agentId,
            enabled: true,
            priority: 100,
            users: { enabled: true, listen },
            source_type: "bootstrap",
            status: "active",
            updated_by: actor,
            updated_at: now,
          },
          $setOnInsert: {
            created_by: actor,
            created_at: now,
          },
        },
        { upsert: true }
      );
      routesEnsured = 1;
    }
  }

  const writes: UniversalRebacRelationship[] = [
    webexSpaceGrantRelationship(workspaceId, canonicalSpaceId, { type: "agent", id: agentId }, "use"),
    {
      subject: { type: "team", id: teamSlug, relation: "member" },
      action: "use",
      resource: { type: "agent", id: agentId },
    },
    // Inbound team→space visibility. Without these, the admin
    // /api/admin/webex/spaces listing route filters this space out because
    // no user can `can_read` the space object in OpenFGA. Mirrors the Slack
    // channel onboarding fix in defaults/route.ts.
    ...webexSpaceTeamVisibilityRelationships(workspaceId, canonicalSpaceId, teamSlug),
  ];
  const openfga = await writeOpenFgaTuples(buildUniversalRebacTupleDiff({ writes, deletes: [] }));
  if (!openfga.enabled) {
    throw new ApiError("OpenFGA is not configured", 502);
  }

  let runtimeReload: WebexSpaceOnboardingResult["runtime_reload"] = {
    attempted: false,
    ok: true,
  };
  if (input.reload_runtime !== false) {
    try {
      const result = await callWebexBotAdmin("/admin/webex/routes/reload", {
        method: "POST",
        body: { workspace_id: workspaceId, space_id: canonicalSpaceId },
      });
      runtimeReload = { attempted: true, ok: true, result };
    } catch (error) {
      runtimeReload = {
        attempted: true,
        ok: false,
        error: error instanceof Error ? error.message : "Webex bot runtime reload failed",
      };
    }
  }

  return {
    summary: {
      dry_run: false,
      spaces_seen: 1,
      mappings_ensured: 1,
      space_grants_ensured: 1,
      routes_ensured: routesEnsured,
      routes_preserved: routesPreserved,
      team_grant_ensured: true,
    },
    space: {
      workspace_id: workspaceId,
      space_id: canonicalSpaceId,
      ...(publicWebexRoomIdFromUuid(canonicalSpaceId)
        ? { webex_room_id: publicWebexRoomIdFromUuid(canonicalSpaceId) }
        : {}),
      space_name: spaceName,
      team_slug: teamSlug,
      team_id: String(team._id),
      agent_id: agentId,
      listen,
    },
    openfga,
    runtime_reload: runtimeReload,
  };
}
