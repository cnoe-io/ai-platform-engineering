import type { Document, Filter } from "mongodb";

import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import { defaultWebexBotId } from "@/lib/webex-bot-catalog";

export interface LegacyWebexBotMigrationResult {
  default_bot_id?: string;
  skipped: boolean;
  legacy_records_found: number;
  team_mappings_updated: number;
  agent_routes_updated: number;
}

const LEGACY_BOT_FILTER: Filter<Document> = {
  $or: [
    { bot_id: { $exists: false } },
    { bot_id: null },
    { bot_id: "" },
  ],
};

/** Assign pre-multi-bot Webex space records to the deployment's default bot. */
export async function migrateLegacyWebexBotOwnership(): Promise<LegacyWebexBotMigrationResult> {
  const defaultBotId = defaultWebexBotId();
  const [mappings, routes] = await Promise.all([
    getRbacCollection<Document>("webexSpaceTeamMappings"),
    getRbacCollection<Document>("webexSpaceAgentRoutes"),
  ]);
  if (!defaultBotId) {
    const [mappingCount, routeCount] = await Promise.all([
      mappings.countDocuments(LEGACY_BOT_FILTER),
      routes.countDocuments(LEGACY_BOT_FILTER),
    ]);
    return {
      skipped: true,
      legacy_records_found: mappingCount + routeCount,
      team_mappings_updated: 0,
      agent_routes_updated: 0,
    };
  }
  const [mappingResult, routeResult] = await Promise.all([
    mappings.updateMany(LEGACY_BOT_FILTER, { $set: { bot_id: defaultBotId } }),
    routes.updateMany(LEGACY_BOT_FILTER, { $set: { bot_id: defaultBotId } }),
  ]);
  return {
    default_bot_id: defaultBotId,
    skipped: false,
    legacy_records_found: mappingResult.matchedCount + routeResult.matchedCount,
    team_mappings_updated: mappingResult.modifiedCount,
    agent_routes_updated: routeResult.modifiedCount,
  };
}
