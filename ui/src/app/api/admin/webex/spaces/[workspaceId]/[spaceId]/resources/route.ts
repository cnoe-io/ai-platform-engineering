import { NextRequest } from "next/server";

import { ApiError,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { type OpenFgaTupleKey, writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { isSupportedResourceAction } from "@/lib/rbac/resource-model";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
import {
listWebexSpaceGrants,
replaceWebexSpaceGrants,
WEBEX_SPACE_GRANT_RESOURCE_TYPES,
type WebexSpaceGrantInput,
} from "@/lib/rbac/webex-space-grant-store";
import {
listOpenFgaWebexBotAgentIds,
parseWebexSpaceRouteParams,
} from "@/lib/rbac/webex-space-openfga";
import {
  webexBotInstallationAgentTuple,
  webexBotInstallationIdentityTuples,
} from "@/lib/rbac/webex-bot-openfga";
import { webexSpaceGrantRelationship } from "@/lib/rbac/webex-space-rebac";
import { requireAvailableWebexBotId } from "@/lib/webex-bot-catalog";
import type { UniversalRebacResourceAction } from "@/types/rbac-universal";
import type { WebexSpaceGrantResourceType } from "@/types/webex-rebac";

import { withWebexSpaceRebacManageAuth,withWebexSpaceRebacViewAuth } from "../../../_lib";

interface RouteContext {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

async function listOpenFgaAgentGrants(
  botId: string,
  workspaceId: string,
  spaceId: string,
): Promise<WebexSpaceGrantInput[]> {
  const agentIds = await listOpenFgaWebexBotAgentIds(botId, workspaceId, spaceId);
  return agentIds.map((agentId) => ({
    workspace_id: workspaceId,
    space_id: spaceId,
    resource: { type: "agent" as const, id: agentId },
    actions: ["use" as const],
  }));
}

async function writeRequiredOpenFgaTuples(
  writes: ReturnType<typeof webexSpaceGrantRelationship>[],
  deletes: ReturnType<typeof webexSpaceGrantRelationship>[],
  rawWrites: OpenFgaTupleKey[] = [],
  rawDeletes: OpenFgaTupleKey[] = [],
) {
  const relationshipDiff = buildUniversalRebacTupleDiff({ writes, deletes });
  const result = await writeOpenFgaTuples({
    writes: [...relationshipDiff.writes, ...rawWrites],
    deletes: [...relationshipDiff.deletes, ...rawDeletes],
  });
  if (!result.enabled) {
    throw new Error("OpenFGA is not configured");
  }
  return result;
}

function parseGrant(value: unknown, index: number): Omit<WebexSpaceGrantInput, "workspace_id" | "space_id"> {
  if (!value || typeof value !== "object") {
    throw new ApiError(`grants[${index}] must be an object`, 400);
  }
  const input = value as Record<string, unknown>;
  const resource = input.resource as Record<string, unknown> | undefined;
  const type = typeof resource?.type === "string" ? resource.type.trim() : "";
  const id = typeof resource?.id === "string" ? resource.id.trim() : "";
  if (!WEBEX_SPACE_GRANT_RESOURCE_TYPES.has(type as WebexSpaceGrantResourceType) || !id) {
    throw new ApiError(`grants[${index}].resource must include a supported type and id`, 400);
  }
  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw new ApiError(`grants[${index}].actions must be a non-empty array`, 400);
  }
  const actions = input.actions.map((action) => String(action).trim()).filter(Boolean);
  for (const action of actions) {
    if (!isSupportedResourceAction(type as WebexSpaceGrantResourceType, action as UniversalRebacResourceAction)) {
      throw new ApiError(
        `grants[${index}].actions contains unsupported action "${action}" for resource type "${type}"`,
        400
      );
    }
  }
  return {
    resource: { type: type as WebexSpaceGrantResourceType, id },
    actions: actions as UniversalRebacResourceAction[],
  };
}

function toGrantInputs(
  workspaceId: string,
  spaceId: string,
  docs: Awaited<ReturnType<typeof listWebexSpaceGrants>>,
  actor: string
): WebexSpaceGrantInput[] {
  return docs
    .filter((doc) => doc.source_type !== "route")
    .map((doc) => ({
      workspace_id: workspaceId,
      space_id: spaceId,
      resource: doc.resource,
      actions: doc.actions,
      created_by: doc.created_by ?? actor,
    }));
}

export const GET = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const raw = await context.params;
  const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);
  return withWebexSpaceRebacViewAuth(request, async () => {
    const botId = requireAvailableWebexBotId(request.nextUrl.searchParams.get("bot_id"));
    const grants = await listOpenFgaAgentGrants(botId, workspaceId, spaceId);
    return successResponse({ grants });
  }, { workspaceId, spaceId });
});

export const PUT = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  const raw = await context.params;
  const { workspaceId, spaceId } = parseWebexSpaceRouteParams(raw.workspaceId, raw.spaceId);
  return withWebexSpaceRebacManageAuth(request, async () => {
    const botId = requireAvailableWebexBotId(request.nextUrl.searchParams.get("bot_id"));
    const body = (await request.json()) as { grants?: unknown };
    if (!Array.isArray(body.grants)) {
      throw new ApiError("grants must be an array", 400);
    }

    const actor = "api";
    const grants = body.grants.map((grant, index) => ({
      workspace_id: workspaceId,
      space_id: spaceId,
      ...parseGrant(grant, index),
      created_by: actor,
    }));

    const previousMongo = await listWebexSpaceGrants(workspaceId, spaceId);
    const previousGrantInputs = toGrantInputs(workspaceId, spaceId, previousMongo, actor);

    const existingAgentIds = await listOpenFgaWebexBotAgentIds(botId, workspaceId, spaceId);
    const nextAgentIds = grants
      .filter((grant) => grant.resource.type === "agent" && grant.actions.includes("use"))
      .map((grant) => grant.resource.id);
    const writes = grants
      .filter((grant) => grant.resource.type !== "agent")
      .flatMap((grant) =>
      grant.actions.map((action) =>
        webexSpaceGrantRelationship(workspaceId, spaceId, grant.resource, action)
      )
    );
    const agentWrites = [
      ...webexBotInstallationIdentityTuples(botId, workspaceId, spaceId),
      ...nextAgentIds.map((agentId) =>
        webexBotInstallationAgentTuple(botId, workspaceId, spaceId, agentId),
      ),
    ];
    const agentDeletes = existingAgentIds
      .filter((agentId) => !nextAgentIds.includes(agentId))
      .map((agentId) =>
        webexBotInstallationAgentTuple(botId, workspaceId, spaceId, agentId),
      );

    const saved = await replaceWebexSpaceGrants(workspaceId, spaceId, grants, actor);
    try {
      const openfga = await writeRequiredOpenFgaTuples(writes, [], agentWrites, agentDeletes);
      return successResponse({ grants: saved, openfga });
    } catch (error) {
      await replaceWebexSpaceGrants(workspaceId, spaceId, previousGrantInputs, actor);
      throw new ApiError(
        error instanceof Error ? `OpenFGA tuple write failed: ${error.message}` : "OpenFGA tuple write failed",
        502
      );
    }
  }, { workspaceId, spaceId });
});
