import type { Document } from "mongodb";
import { NextRequest } from "next/server";

import {
ApiError,
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import {
OnboardingDefaultsValidationError,
readOnboardingDefaults,
writeOnboardingDefaults,
} from "@/lib/rbac/onboarding-defaults";
import { webexWorkspaceRef } from "@/lib/rbac/webex-space-grant-store";
import {
canonicalizeWebexSpaceId,
onboardWebexSpace,
type WebexSpaceOnboardingResult,
} from "@/lib/rbac/webex-space-onboarding";
import { callWebexBotAdmin } from "@/lib/webex-bot-admin";

import { withWebexSpaceRebacManageAuth,withWebexSpaceRebacViewAuth } from "../_lib";

interface WebexMigrationDefaultsRequest {
  team_slug?: unknown;
  agent_id?: unknown;
  create_routes?: unknown;
  manual_spaces?: unknown;
}

interface WebexSpaceTeamMappingDoc extends Document {
  webex_workspace_id?: string;
  webex_space_id: string;
  space_name?: string;
  space_title?: string;
  active?: boolean;
}

interface ManualWebexSpace {
  workspace_id: string;
  space_id: string;
  space_name: string;
}

const WEBEX_SPACE_ID_RE = /^[a-zA-Z0-9._-]{8,128}$/;

export const GET = withErrorHandler(async (request: NextRequest) =>
  withWebexSpaceRebacViewAuth(request, async () => {
    // DB-first read so admin's saved picks survive a page reload.
    // Falls back to `WEBEX_DEFAULT_TEAM_SLUG` / `WEBEX_DEFAULT_AGENT_ID`
    // when nothing has been saved yet.
    const defaults = await readOnboardingDefaults("webex");
    return successResponse({ defaults });
  }),
);

/**
 * PUT — save the onboarding defaults without running the onboarding
 * pipeline. The migration POST below remains unchanged.
 */
export const PUT = withErrorHandler(async (request: NextRequest) =>
  withWebexSpaceRebacManageAuth(request, async () => {
    const { session } = await getAuthFromBearerOrSession(request);
    const body = (await request.json().catch(() => ({}))) as WebexMigrationDefaultsRequest;
    const teamSlug = readOptionalString(body.team_slug);
    const agentId = readOptionalString(body.agent_id);
    const createRoutes =
      typeof body.create_routes === "boolean" ? body.create_routes : true;

    try {
      const saved = await writeOnboardingDefaults("webex", {
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

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(`${field} is required`, 400);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeManualSpaces(value: unknown): ManualWebexSpace[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ApiError("manual_spaces must be an array", 400);
  }

  const byKey = new Map<string, ManualWebexSpace>();
  value.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ApiError(`manual_spaces[${index}] must be an object`, 400);
    }
    const record = item as Record<string, unknown>;
    const rawSpaceId = readOptionalString(record.id) || readOptionalString(record.space_id);
    const spaceId = canonicalizeWebexSpaceId(rawSpaceId);
    if (!WEBEX_SPACE_ID_RE.test(spaceId)) {
      throw new ApiError(`manual_spaces[${index}].id must be a valid Webex space ID`, 400);
    }
    const workspaceId = webexWorkspaceRef(readOptionalString(record.workspace_id));
    const spaceName = readOptionalString(record.name) || readOptionalString(record.space_name) || spaceId;
    byKey.set(`${workspaceId}/${spaceId}`, {
      workspace_id: workspaceId,
      space_id: spaceId,
      space_name: spaceName,
    });
  });
  return Array.from(byKey.values());
}

function validateDefaultsBody(body: Record<string, unknown>): void {
  const allowedFields = new Set(["team_slug", "agent_id", "create_routes", "manual_spaces"]);
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      throw new ApiError(`Unexpected field "${key}"`, 400);
    }
  }
}

function activeMappingToManualSpace(mapping: WebexSpaceTeamMappingDoc): ManualWebexSpace {
  const workspaceId = webexWorkspaceRef(mapping.webex_workspace_id);
  return {
    workspace_id: workspaceId,
    space_id: mapping.webex_space_id,
    space_name: mapping.space_name || mapping.space_title || mapping.webex_space_id,
  };
}

async function reloadWebexRuntime(): Promise<WebexSpaceOnboardingResult["runtime_reload"]> {
  try {
    const result = await callWebexBotAdmin("/admin/webex/routes/reload", {
      method: "POST",
      body: {},
    });
    return { attempted: true, ok: true, result };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : "Webex bot runtime reload failed",
    };
  }
}

function aggregateOpenFga(results: WebexSpaceOnboardingResult[]) {
  return results.reduce(
    (acc, result) => ({
      enabled: acc.enabled && Boolean(result.openfga?.enabled),
      writes: acc.writes + (result.openfga?.writes ?? 0),
      deletes: acc.deletes + (result.openfga?.deletes ?? 0),
    }),
    { enabled: true, writes: 0, deletes: 0 }
  );
}

export const POST = withErrorHandler(async (request: NextRequest) =>
  withWebexSpaceRebacManageAuth(request, async () => {
    const body = (await request.json()) as WebexMigrationDefaultsRequest;
    validateDefaultsBody(body as Record<string, unknown>);
    const teamSlug = readRequiredString(body.team_slug, "team_slug");
    const agentId = readRequiredString(body.agent_id, "agent_id");
    const createRoutes = body.create_routes === undefined ? true : Boolean(body.create_routes);
    const manualSpaces = normalizeManualSpaces(body.manual_spaces);

    let targetSpaces = manualSpaces;
    if (targetSpaces.length === 0) {
      const mappings = await getRbacCollection<WebexSpaceTeamMappingDoc>("webexSpaceTeamMappings");
      const spaces = await mappings
        .find({ active: { $ne: false } } as never)
        .sort({ space_name: 1 })
        .limit(500)
        .toArray();
      targetSpaces = spaces.map(activeMappingToManualSpace);
    }

    if (targetSpaces.length === 0) {
      throw new ApiError("No onboarded Webex spaces found", 400);
    }

    const results: WebexSpaceOnboardingResult[] = [];
    for (const space of targetSpaces) {
      results.push(
        await onboardWebexSpace({
          workspace_id: space.workspace_id,
          space_id: space.space_id,
          space_name: space.space_name,
          team_slug: teamSlug,
          agent_id: agentId,
          listen: "mention",
          create_route: createRoutes,
          reload_runtime: false,
          actor: "api",
        })
      );
    }

    const runtimeReload = await reloadWebexRuntime();
    const routeSummary = results.reduce(
      (acc, result) => ({
        routes_ensured: acc.routes_ensured + result.summary.routes_ensured,
        routes_preserved: acc.routes_preserved + result.summary.routes_preserved,
      }),
      { routes_ensured: 0, routes_preserved: 0 }
    );
    const first = results[0];

    return successResponse({
      summary: {
        spaces_seen: results.length,
        spaces_manual: manualSpaces.length,
        spaces_onboarded: results.reduce((sum, result) => sum + result.summary.mappings_ensured, 0),
        spaces_assigned_team: results.length,
        space_grants_ensured: results.reduce(
          (sum, result) => sum + result.summary.space_grants_ensured,
          0
        ),
        routes_ensured: routeSummary.routes_ensured,
        routes_preserved: routeSummary.routes_preserved,
        team_grant_ensured: true,
      },
      defaults: {
        team_slug: teamSlug,
        team_id: first.space.team_id,
        agent_id: agentId,
      },
      openfga: aggregateOpenFga(results),
      runtime_reload: runtimeReload,
    });
  })
);
