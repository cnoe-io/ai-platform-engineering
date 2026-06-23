import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { callWebexBotAdmin } from "@/lib/webex-bot-admin";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";

import {
  getWebexSpaceDiscoveryStatus,
  warmWebexSpaceDiscovery,
} from "../../available-spaces/route";

interface WebexBotRuntimeStatus {
  route_mode?: string;
  static_spaces?: number;
  static_routes?: number;
  cache_size?: number;
}

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("#")) return null;
  if (value.startsWith("<") && value.endsWith(">")) return null;
  if (value.toLowerCase().includes("your-")) return null;
  return value;
}

function envEnabled(name: string): boolean {
  const value = envValue(name)?.toLowerCase();
  return value ? ENABLED_VALUES.has(value) : false;
}

function hasComposeProfile(...profileNames: string[]): boolean {
  const profiles = new Set(
    (process.env.COMPOSE_PROFILES ?? "")
      .split(",")
      .map((profile) => profile.trim())
      .filter(Boolean),
  );
  return profileNames.some((profile) => profiles.has(profile));
}

function webexIntegrationToken(): string | null {
  return (
    envValue("WEBEX_INTEGRATION_BOT_ACCESS_TOKEN") ??
    envValue("WEBEX_ACCESS_TOKEN") ??
    envValue("WEBEX_TOKEN")
  );
}

function webexIntegrationEnabled(): boolean {
  return (
    Boolean(
      envEnabled("WEBEX_INTEGRATION_ENABLED") ||
        webexIntegrationToken() ||
        envValue("WEBEX_BOT_ADMIN_CLIENT_SECRET") ||
        envValue("KEYCLOAK_WEBEX_BOT_ADMIN_CLIENT_SECRET"),
    ) ||
    hasComposeProfile("webex-bot", "all-integrations")
  );
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
    };
    return {
      reachable: true,
      runtime: {
        route_mode: status.route_mode,
        static_spaces: status.static_config?.spaces,
        static_routes: status.static_config?.routes,
        cache_size: status.route_cache?.cache_size,
      },
    };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");

  const enabled = webexIntegrationEnabled();
  const integrationToken = webexIntegrationToken();
  if (integrationToken) {
    warmWebexSpaceDiscovery(integrationToken);
  }

  const bot_admin = await webexBotAdminStatus();
  const platform = await webexPlatformConfigSummary();
  const space_discovery = integrationToken
    ? {
        configured: true,
        ...(await getWebexSpaceDiscoveryStatus(integrationToken)),
      }
    : {
        configured: false,
        status: "empty" as const,
        spaces_indexed: 0,
        fetched_at: null,
        updated_at: null,
        started_at: null,
        ttl_seconds: 0,
        last_error: undefined,
      };

  return successResponse({
    configured: enabled,
    bot_admin,
    platform,
    space_discovery,
  });
});
