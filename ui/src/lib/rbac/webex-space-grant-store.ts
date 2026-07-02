import type { Document } from "mongodb";

import type { UniversalRebacResourceAction,UniversalRebacResourceRef } from "@/types/rbac-universal";
import type {
WebexSpaceGrantResourceType,
WebexSpaceResourceGrant,
} from "@/types/webex-rebac";

import { getRbacCollection } from "./mongo-collections";

export interface WebexSpaceGrantDocument extends Document, WebexSpaceResourceGrant {}

export interface WebexSpaceGrantInput {
  workspace_id: string;
  space_id: string;
  resource: UniversalRebacResourceRef & { type: WebexSpaceGrantResourceType };
  actions: UniversalRebacResourceAction[];
  created_by?: string;
}

export const WEBEX_SPACE_GRANT_RESOURCE_TYPES = new Set<WebexSpaceGrantResourceType>([
  "agent",
  "tool",
  "knowledge_base",
  "skill",
  "task",
]);

export function webexWorkspaceRef(workspaceId?: string | null): string {
  const alias = process.env.WEBEX_WORKSPACE_ALIAS?.trim();
  if (alias) return alias;
  const candidate = workspaceId?.trim();
  if (candidate) return candidate;
  return process.env.WEBEX_WORKSPACE_ID?.trim() || "unknown";
}

export function webexSpaceSubjectId(workspaceId: string, spaceId: string): string {
  return `${webexWorkspaceRef(workspaceId)}--${spaceId}`;
}

export async function listWebexSpaceGrants(
  workspaceId: string,
  spaceId: string
): Promise<WebexSpaceGrantDocument[]> {
  const collection = await getRbacCollection<WebexSpaceGrantDocument>("webexSpaceGrants");
  const workspaceRef = webexWorkspaceRef(workspaceId);
  const rows = await collection
    .find({
      workspace_id: workspaceRef,
      space_id: spaceId,
      status: "active",
    } as never)
    .sort({ "resource.type": 1, "resource.id": 1 })
    .toArray();
  return rows as WebexSpaceGrantDocument[];
}

export async function replaceWebexSpaceGrants(
  workspaceId: string,
  spaceId: string,
  grants: WebexSpaceGrantInput[],
  actor: string
): Promise<WebexSpaceGrantDocument[]> {
  const collection = await getRbacCollection<WebexSpaceGrantDocument>("webexSpaceGrants");
  const now = new Date().toISOString();
  const workspaceRef = webexWorkspaceRef(workspaceId);

  await collection.updateMany(
    {
      workspace_id: workspaceRef,
      space_id: spaceId,
      status: "active",
      source_type: { $ne: "route" },
    } as never,
    { $set: { status: "revoked", updated_by: actor, updated_at: now } }
  );

  for (const grant of grants) {
    await collection.updateOne(
      {
        workspace_id: workspaceRef,
        space_id: spaceId,
        "resource.type": grant.resource.type,
        "resource.id": grant.resource.id,
      } as never,
      {
        $set: {
          workspace_id: workspaceRef,
          space_id: spaceId,
          resource: grant.resource,
          actions: grant.actions,
          source_type: "manual",
          status: "active",
          created_by: grant.created_by ?? actor,
          created_at: now,
          updated_by: actor,
          updated_at: now,
        },
      },
      { upsert: true }
    );
  }

  return listWebexSpaceGrants(workspaceRef, spaceId);
}

// assisted-by Codex Codex-sonnet-4-6
export async function deleteWebexSpaceGrants(
  workspaceId: string,
  spaceId: string
): Promise<number> {
  const collection = await getRbacCollection<WebexSpaceGrantDocument>("webexSpaceGrants");
  const workspaceRef = webexWorkspaceRef(workspaceId);
  const result = await collection.deleteMany({
    workspace_id: workspaceRef,
    space_id: spaceId,
  } as never);
  return result.deletedCount ?? 0;
}

export async function ensureRouteOwnedAgentGrants(
  workspaceId: string,
  spaceId: string,
  agentIds: string[],
  actor: string
): Promise<void> {
  const collection = await getRbacCollection<WebexSpaceGrantDocument>("webexSpaceGrants");
  const now = new Date().toISOString();
  const workspaceRef = webexWorkspaceRef(workspaceId);
  const uniqueAgentIds = Array.from(new Set(agentIds.map((id) => id.trim()).filter(Boolean)));

  await collection.updateMany(
    {
      workspace_id: workspaceRef,
      space_id: spaceId,
      source_type: "route",
      status: "active",
      "resource.type": "agent",
      "resource.id": { $nin: uniqueAgentIds },
    } as never,
    { $set: { status: "revoked", updated_by: actor, updated_at: now } }
  );

  for (const agentId of uniqueAgentIds) {
    const existing = await collection.findOne({
      workspace_id: workspaceRef,
      space_id: spaceId,
      status: "active",
      "resource.type": "agent",
      "resource.id": agentId,
    } as never);

    if (existing && existing.source_type !== "route") {
      continue;
    }

    const createdAt =
      existing?.source_type === "route" && existing.created_at ? existing.created_at : now;

    await collection.updateOne(
      {
        workspace_id: workspaceRef,
        space_id: spaceId,
        source_type: "route",
        "resource.type": "agent",
        "resource.id": agentId,
      } as never,
      {
        $set: {
          workspace_id: workspaceRef,
          space_id: spaceId,
          resource: { type: "agent", id: agentId },
          actions: ["use"],
          source_type: "route",
          status: "active",
          created_by: existing?.created_by ?? actor,
          created_at: createdAt,
          updated_by: actor,
          updated_at: now,
        },
      },
      { upsert: true }
    );
  }
}
