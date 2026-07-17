import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { callWebexBotAdmin } from "@/lib/webex-bot-admin";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";

interface WebexBotRuntimeStatus {
  route_mode?: string;
  static_spaces?: number;
  static_routes?: number;
  cache_size?: number;
  bots_available?: number;
  space_discovery?: {
    bots?: Record<string, {
      spaces_indexed?: number;
      fetched_at?: number;
      last_error?: string;
    }>;
    last_errors?: Record<string, string>;
  };
}

async function webexPlatformConfigSummary(): Promise<{
  reachable: boolean;
  spaces_onboarded: number;
  routes_configured: number;
  error?: string;
}> {
  try {
    const [mappings, routes] = await Promise.all([
      getRbacCollection<{ active?: boolean }>("webexSpaceTeamMappings"),
      getRbacCollection<{ enabled?: boolean }>("webexSpaceAgentRoutes"),
    ]);
    const [spaces_onboarded, routes_configured] = await Promise.all([
      mappings.countDocuments({ active: { $ne: false } }),
      routes.countDocuments({ enabled: { $ne: false } }),
    ]);
    return { reachable: true, spaces_onboarded, routes_configured };
  } catch (err) {
    return {
      reachable: false,
      spaces_onboarded: 0,
      routes_configured: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function webexBotAdminStatus(): Promise<{
  reachable: boolean;
  error?: string;
  runtime?: WebexBotRuntimeStatus;
}> {
  try {
    const status = (await callWebexBotAdmin("/admin/webex/routes/status")) as {
      route_mode?: string;
      static_config?: { spaces?: number; routes?: number };
      route_cache?: { cache_size?: number };
      space_discovery?: WebexBotRuntimeStatus["space_discovery"];
    };
    const catalog = await callWebexBotAdmin<{
      bots?: Array<{ available?: boolean }>;
    }>("/admin/webex/bots");
    return {
      reachable: true,
      runtime: {
        route_mode: status.route_mode,
        static_spaces: status.static_config?.spaces,
        static_routes: status.static_config?.routes,
        cache_size: status.route_cache?.cache_size,
        bots_available: (catalog.bots ?? []).filter((bot) => bot.available).length,
        space_discovery: status.space_discovery,
      },
    };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

  const bot_admin = await webexBotAdminStatus();
  const platform = await webexPlatformConfigSummary();
  const configured =
    bot_admin.reachable ||
    platform.spaces_onboarded > 0 ||
    platform.routes_configured > 0;
  const discoveryBots = Object.values(bot_admin.runtime?.space_discovery?.bots ?? {});
  const spacesIndexed = discoveryBots.reduce(
    (total, bot) => total + Number(bot.spaces_indexed ?? 0),
    0,
  );
  const fetchedAt = discoveryBots.reduce<number | null>((latest, bot) => {
    const value = Number(bot.fetched_at ?? 0);
    return value > (latest ?? 0) ? value : latest;
  }, null);
  const errors = Object.values(bot_admin.runtime?.space_discovery?.last_errors ?? {});
  const space_discovery = {
    configured: (bot_admin.runtime?.bots_available ?? 0) > 0,
    status: errors.length > 0 ? "stale" as const : spacesIndexed > 0 ? "ready" as const : "empty" as const,
    spaces_indexed: spacesIndexed,
    fetched_at: fetchedAt,
    updated_at: fetchedAt,
    started_at: null,
    ttl_seconds: 0,
    last_error: errors[0],
  };

  return successResponse({
    configured,
    bot_admin,
    platform,
    space_discovery,
  });
});
