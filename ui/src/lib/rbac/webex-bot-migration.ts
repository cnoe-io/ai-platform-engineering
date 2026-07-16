import type { Document, Filter } from "mongodb";

import { ApiError } from "@/lib/api-error";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import {
  deleteExactOpenFgaTuples,
  readOpenFgaTuples,
  writeOpenFgaTuples,
  type OpenFgaTupleKey,
} from "@/lib/rbac/openfga";
import {
  webexBotInstallationAgentTuple,
  webexBotInstallationIdentityTuples,
} from "@/lib/rbac/webex-bot-openfga";
import { webexWorkspaceRef } from "@/lib/rbac/webex-space-grant-store";
import { configuredWebexBots } from "@/lib/webex-bot-catalog";

interface LegacyTeamMapping extends Document {
  bot_id?: string | null;
  webex_workspace_id?: string;
  webex_space_id?: string;
  workspace_id?: string;
  space_id?: string;
  space_name?: string;
  space_title?: string;
  team_id?: string;
  team_slug?: string;
}

interface LegacyAgentRoute extends Document {
  bot_id?: string | null;
  workspace_id?: string;
  space_id?: string;
  agent_id?: string;
}

export interface LegacyWebexTeamMappingDetail {
  team_id: string;
  team_slug: string;
}

export interface LegacyWebexMongoRouteDetail {
  agent_id: string;
}

export interface LegacyWebexBotMigrationCandidate {
  workspace_id: string;
  space_id: string;
  space_name: string;
  team_mapping_count: number;
  route_count: number;
  mongo_agent_ids: string[];
  openfga_agent_ids: string[];
  mapping_details: LegacyWebexTeamMappingDetail[];
  mongo_route_details: LegacyWebexMongoRouteDetail[];
  openfga_grants: OpenFgaTupleKey[];
}

export interface LegacyWebexBotMigrationAssignment {
  workspace_id: string;
  space_id: string;
  bot_id: string;
}

export interface LegacyWebexBotMigrationTarget {
  workspace_id: string;
  space_id: string;
}

export interface LegacyWebexBotMigrationResult {
  spaces_migrated: number;
  team_mappings_updated: number;
  agent_routes_updated: number;
  agent_routes_created: number;
  openfga_tuples_written: number;
  legacy_openfga_tuples_deleted: number;
}

export interface LegacyWebexBotCleanupResult {
  spaces_cleaned: number;
  team_mappings_deleted: number;
  agent_routes_deleted: number;
  legacy_openfga_tuples_deleted: number;
}

const LEGACY_BOT_FILTER: Filter<Document> = {
  $or: [
    { bot_id: { $exists: false } },
    { bot_id: null },
    { bot_id: "" },
  ],
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function coordinates(doc: LegacyTeamMapping | LegacyAgentRoute): {
  workspaceId: string;
  spaceId: string;
} | null {
  const mapping = doc as LegacyTeamMapping;
  const workspaceId =
    text(mapping.webex_workspace_id) ||
    text(mapping.workspace_id) ||
    webexWorkspaceRef();
  const spaceId = text(mapping.webex_space_id) || text(mapping.space_id);
  return spaceId ? { workspaceId, spaceId } : null;
}

function candidateKey(workspaceId: string, spaceId: string): string {
  return `${workspaceId}\n${spaceId}`;
}

function parseLegacySpaceUser(user: string): { workspaceId: string; spaceId: string } | null {
  if (!user.startsWith("webex_space:")) return null;
  const id = user.slice("webex_space:".length);
  const separator = id.lastIndexOf("--");
  if (separator <= 0 || separator === id.length - 2) return null;
  return {
    workspaceId: id.slice(0, separator),
    spaceId: id.slice(separator + 2),
  };
}

function agentIdFromObject(object: string): string | null {
  if (!object.startsWith("agent:")) return null;
  return text(object.slice("agent:".length)) || null;
}

async function listLegacyOpenFgaRouteTuples(): Promise<OpenFgaTupleKey[]> {
  const tuples: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await readOpenFgaTuples({
      pageSize: 100,
      ...(continuationToken ? { continuationToken } : {}),
    });
    for (const tuple of result.tuples) {
      if (parseLegacySpaceUser(tuple.key.user) && agentIdFromObject(tuple.key.object)) {
        tuples.push(tuple.key);
      }
    }
    continuationToken = result.continuationToken;
  } while (continuationToken);
  return tuples;
}

export async function probeLegacyWebexBotOwnership(): Promise<
  LegacyWebexBotMigrationCandidate[]
> {
  const [mappings, routes] = await Promise.all([
    getRbacCollection<LegacyTeamMapping>("webexSpaceTeamMappings"),
    getRbacCollection<LegacyAgentRoute>("webexSpaceAgentRoutes"),
  ]);
  const [legacyMappings, legacyRoutes, legacyTuples] = await Promise.all([
    mappings.find(LEGACY_BOT_FILTER as Filter<LegacyTeamMapping>).toArray(),
    routes.find(LEGACY_BOT_FILTER as Filter<LegacyAgentRoute>).toArray(),
    listLegacyOpenFgaRouteTuples(),
  ]);

  const candidates = new Map<
    string,
    LegacyWebexBotMigrationCandidate & { mongoAgents: Set<string>; openfgaAgents: Set<string> }
  >();
  const ensure = (workspaceId: string, spaceId: string) => {
    const key = candidateKey(workspaceId, spaceId);
    const existing = candidates.get(key);
    if (existing) return existing;
    const created: LegacyWebexBotMigrationCandidate & {
      mongoAgents: Set<string>;
      openfgaAgents: Set<string>;
    } = {
      workspace_id: workspaceId,
      space_id: spaceId,
      space_name: spaceId,
      team_mapping_count: 0,
      route_count: 0,
      mongo_agent_ids: [],
      openfga_agent_ids: [],
      mapping_details: [],
      mongo_route_details: [],
      openfga_grants: [],
      mongoAgents: new Set<string>(),
      openfgaAgents: new Set<string>(),
    };
    candidates.set(key, created);
    return created;
  };

  for (const mapping of legacyMappings) {
    const ids = coordinates(mapping);
    if (!ids) continue;
    const candidate = ensure(ids.workspaceId, ids.spaceId);
    candidate.team_mapping_count += 1;
    candidate.space_name = text(mapping.space_name) || text(mapping.space_title) || candidate.space_name;
    candidate.mapping_details.push({
      team_id: text(mapping.team_id),
      team_slug: text(mapping.team_slug),
    });
  }
  for (const route of legacyRoutes) {
    const ids = coordinates(route);
    if (!ids) continue;
    const candidate = ensure(ids.workspaceId, ids.spaceId);
    candidate.route_count += 1;
    const agentId = text(route.agent_id);
    candidate.mongo_route_details.push({ agent_id: agentId });
    if (agentId) {
      candidate.mongoAgents.add(agentId);
    }
  }
  for (const tuple of legacyTuples) {
    const ids = parseLegacySpaceUser(tuple.user);
    const agentId = agentIdFromObject(tuple.object);
    if (!ids || !agentId) continue;
    const candidate = ensure(ids.workspaceId, ids.spaceId);
    candidate.openfgaAgents.add(agentId);
    candidate.openfga_grants.push(tuple);
  }

  return Array.from(candidates.values())
    .map(({ mongoAgents, openfgaAgents, ...candidate }) => ({
      ...candidate,
      mongo_agent_ids: Array.from(mongoAgents).sort(),
      openfga_agent_ids: Array.from(openfgaAgents).sort(),
    }))
    .sort((left, right) =>
      left.space_name.localeCompare(right.space_name) ||
      left.workspace_id.localeCompare(right.workspace_id) ||
      left.space_id.localeCompare(right.space_id),
    );
}

export async function deleteLegacyWebexBotOwnership(
  targets: LegacyWebexBotMigrationTarget[],
): Promise<LegacyWebexBotCleanupResult> {
  if (targets.length === 0) {
    throw new ApiError("At least one cleanup target is required", 400);
  }
  const targetKeys = new Set<string>();
  for (const target of targets) {
    const workspaceId = text(target.workspace_id);
    const spaceId = text(target.space_id);
    if (!workspaceId || !spaceId) {
      throw new ApiError("workspace_id and space_id are required", 400);
    }
    targetKeys.add(candidateKey(workspaceId, spaceId));
  }
  const mappings = await getRbacCollection<LegacyTeamMapping>("webexSpaceTeamMappings");
  const routes = await getRbacCollection<LegacyAgentRoute>("webexSpaceAgentRoutes");
  const [legacyMappings, legacyRoutes, legacyTuples] = await Promise.all([
    mappings.find(LEGACY_BOT_FILTER as Filter<LegacyTeamMapping>).toArray(),
    routes.find(LEGACY_BOT_FILTER as Filter<LegacyAgentRoute>).toArray(),
    listLegacyOpenFgaRouteTuples(),
  ]);
  const matchingMappings = legacyMappings.filter((doc) => {
    const ids = coordinates(doc);
    return ids ? targetKeys.has(candidateKey(ids.workspaceId, ids.spaceId)) : false;
  });
  const matchingRoutes = legacyRoutes.filter((doc) => {
    const ids = coordinates(doc);
    return ids ? targetKeys.has(candidateKey(ids.workspaceId, ids.spaceId)) : false;
  });
  const matchingTuples = legacyTuples.filter((tuple) => {
    const ids = parseLegacySpaceUser(tuple.user);
    return ids ? targetKeys.has(candidateKey(ids.workspaceId, ids.spaceId)) : false;
  });
  const foundKeys = new Set<string>();
  for (const doc of [...matchingMappings, ...matchingRoutes]) {
    const ids = coordinates(doc);
    if (ids) foundKeys.add(candidateKey(ids.workspaceId, ids.spaceId));
  }
  for (const tuple of matchingTuples) {
    const ids = parseLegacySpaceUser(tuple.user);
    if (ids) foundKeys.add(candidateKey(ids.workspaceId, ids.spaceId));
  }
  if (foundKeys.size === 0) {
    throw new ApiError("No legacy Webex data found for the selected spaces", 409);
  }

  let openfgaDeleted = 0;
  if (matchingTuples.length > 0) {
    const openfgaDelete = await deleteExactOpenFgaTuples(matchingTuples);
    if (!openfgaDelete.enabled) {
      throw new ApiError("OpenFGA is not configured", 502);
    }
    openfgaDeleted = openfgaDelete.deletes;
  }
  const mappingIds = matchingMappings.map((doc) => doc._id).filter((id) => id !== undefined);
  const routeIds = matchingRoutes.map((doc) => doc._id).filter((id) => id !== undefined);
  const [mappingDelete, routeDelete] = await Promise.all([
    mappingIds.length > 0
      ? mappings.deleteMany({ _id: { $in: mappingIds } } as Filter<LegacyTeamMapping>)
      : Promise.resolve({ deletedCount: 0 }),
    routeIds.length > 0
      ? routes.deleteMany({ _id: { $in: routeIds } } as Filter<LegacyAgentRoute>)
      : Promise.resolve({ deletedCount: 0 }),
  ]);
  return {
    spaces_cleaned: foundKeys.size,
    team_mappings_deleted: mappingDelete.deletedCount,
    agent_routes_deleted: routeDelete.deletedCount,
    legacy_openfga_tuples_deleted: openfgaDeleted,
  };
}

export async function migrateLegacyWebexBotOwnership(
  assignments: LegacyWebexBotMigrationAssignment[],
): Promise<LegacyWebexBotMigrationResult> {
  if (assignments.length === 0) {
    throw new ApiError("At least one migration assignment is required", 400);
  }
  const configuredBotIds = new Set(configuredWebexBots().map((bot) => bot.id));
  const mappings = await getRbacCollection<LegacyTeamMapping>("webexSpaceTeamMappings");
  const routes = await getRbacCollection<LegacyAgentRoute>("webexSpaceAgentRoutes");
  const now = new Date().toISOString();
  const result: LegacyWebexBotMigrationResult = {
    spaces_migrated: 0,
    team_mappings_updated: 0,
    agent_routes_updated: 0,
    agent_routes_created: 0,
    openfga_tuples_written: 0,
    legacy_openfga_tuples_deleted: 0,
  };

  for (const assignment of assignments) {
    const sourceWorkspaceId = text(assignment.workspace_id);
    const destinationWorkspaceId = webexWorkspaceRef(sourceWorkspaceId);
    const spaceId = text(assignment.space_id);
    const botId = text(assignment.bot_id);
    if (!sourceWorkspaceId || !spaceId || !botId) {
      throw new ApiError("workspace_id, space_id, and bot_id are required", 400);
    }
    if (!configuredBotIds.has(botId)) {
      throw new ApiError(`Unknown Webex bot: ${botId}`, 400);
    }

    const [legacyMappings, legacyRoutes, legacyTuples] = await Promise.all([
      mappings.find(LEGACY_BOT_FILTER as Filter<LegacyTeamMapping>).toArray(),
      routes.find(LEGACY_BOT_FILTER as Filter<LegacyAgentRoute>).toArray(),
      listLegacyOpenFgaRouteTuples(),
    ]);
    const matchingMappings = legacyMappings.filter((doc) => {
      const ids = coordinates(doc);
      return ids?.workspaceId === sourceWorkspaceId && ids.spaceId === spaceId;
    });
    const matchingRoutes = legacyRoutes.filter((doc) => {
      const ids = coordinates(doc);
      return ids?.workspaceId === sourceWorkspaceId && ids.spaceId === spaceId;
    });
    const matchingTuples = legacyTuples.filter((tuple) => {
      const ids = parseLegacySpaceUser(tuple.user);
      return ids?.workspaceId === sourceWorkspaceId && ids.spaceId === spaceId;
    });
    const openfgaAgentIds = matchingTuples
      .map((tuple) => agentIdFromObject(tuple.object))
      .filter((agentId): agentId is string => Boolean(agentId));
    const mongoAgentIds = matchingRoutes.map((route) => text(route.agent_id)).filter(Boolean);
    const agentIds = Array.from(new Set([...mongoAgentIds, ...openfgaAgentIds])).sort();
    if (matchingMappings.length === 0 && matchingRoutes.length === 0 && agentIds.length === 0) {
      throw new ApiError(`No legacy Webex data found for space ${spaceId}`, 409);
    }

    const writes = [
      ...webexBotInstallationIdentityTuples(botId, destinationWorkspaceId, spaceId),
      ...agentIds.map((agentId) =>
        webexBotInstallationAgentTuple(botId, destinationWorkspaceId, spaceId, agentId),
      ),
    ];
    const openfgaWrite = await writeOpenFgaTuples({ writes, deletes: [] });
    if (!openfgaWrite.enabled) {
      throw new ApiError("OpenFGA is not configured", 502);
    }

    if (matchingMappings.length > 0) {
      const update = await mappings.updateMany(
        { _id: { $in: matchingMappings.map((doc) => doc._id) } } as Filter<LegacyTeamMapping>,
        {
          $set: {
            bot_id: botId,
            webex_workspace_id: destinationWorkspaceId,
            updated_at: now,
            updated_by: "webex_bot_migration",
          },
        },
      );
      result.team_mappings_updated += update.modifiedCount;
    }
    if (matchingRoutes.length > 0) {
      const update = await routes.updateMany(
        { _id: { $in: matchingRoutes.map((doc) => doc._id) } } as Filter<LegacyAgentRoute>,
        {
          $set: {
            bot_id: botId,
            workspace_id: destinationWorkspaceId,
            updated_at: now,
            updated_by: "webex_bot_migration",
          },
        },
      );
      result.agent_routes_updated += update.modifiedCount;
    }

    const existingRouteAgents = new Set(mongoAgentIds);
    for (const agentId of openfgaAgentIds) {
      if (existingRouteAgents.has(agentId)) continue;
      const upsert = await routes.updateOne(
        { bot_id: botId, workspace_id: destinationWorkspaceId, space_id: spaceId, agent_id: agentId },
        {
          $set: {
            bot_id: botId,
            workspace_id: destinationWorkspaceId,
            space_id: spaceId,
            agent_id: agentId,
            enabled: true,
            priority: 100,
            users: { enabled: true, listen: "mention" },
            source_type: "migration",
            status: "active",
            updated_at: now,
            updated_by: "webex_bot_migration",
          },
          $setOnInsert: { created_at: now, created_by: "webex_bot_migration" },
        },
        { upsert: true },
      );
      result.agent_routes_created += upsert.upsertedCount;
    }

    const openfgaDelete = await deleteExactOpenFgaTuples(matchingTuples);
    if (!openfgaDelete.enabled) {
      throw new ApiError("OpenFGA is not configured", 502);
    }
    result.spaces_migrated += 1;
    result.openfga_tuples_written += openfgaWrite.writes;
    result.legacy_openfga_tuples_deleted += openfgaDelete.deletes;
  }
  return result;
}
