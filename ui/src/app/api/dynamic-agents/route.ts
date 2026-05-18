/**
 * API routes for Dynamic Agents management.
 *
 * All operations use local MongoDB directly.
 * The gateway owns all config writes — DA is a pure runtime reader.
 */

import { NextRequest } from "next/server";
import { Collection, ObjectId } from "mongodb";
import { getCollection } from "@/lib/mongodb";
import {
  withErrorHandler,
  successResponse,
  ApiError,
  getPaginationParams,
  paginatedResponse,
  getAuthFromBearerOrSession,
} from "@/lib/api-middleware";
import type {
  DynamicAgentConfig,
  VisibilityType,
  SubAgentRef,
} from "@/types/dynamic-agent";
import {
  allowedToolsFromAgent,
  deleteAllAgentToolTuples,
  reconcileAgentRelationships,
} from "@/lib/rbac/openfga-agent-tools";
import {
  filterResourcesByPermission,
  requireResourcePermission,
} from "@/lib/rbac/resource-authz";
import { caipeOrgKey } from "@/lib/rbac/organization";

const COLLECTION_NAME = "dynamic_agents";

interface TeamOwnershipDoc {
  _id?: unknown;
  slug?: string;
  name?: string;
  members?: Array<{ user_id?: string; email?: string; role?: string }>;
}

async function canManageOrganization(
  session: Parameters<typeof requireResourcePermission>[0]
): Promise<boolean> {
  try {
    await requireResourcePermission(session, { type: "organization", id: caipeOrgKey(), action: "manage" });
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Reserved agent slugs that cannot be used as agent IDs.
 * These are LangGraph/deepagents internal names that would
 * conflict with namespace routing.
 *
 * Ported from DA mongo.py — DA no longer does slug checks
 * after CRUD migration.
 */
const RESERVED_AGENT_SLUGS = new Set([
  // LangGraph internal node names
  "__start__",
  "__end__",
  "__interrupt__",
  "__checkpoint__",
  "__error__",
  "start",
  "end",
  // LangGraph react agent node names
  "agent",
  "tools",
  "call-model",
  // DeepAgents built-in
  "general-purpose",
  "task",
]);

/**
 * Convert agent name to URL-safe slug.
 *
 * Examples:
 *   'My Test Agent' → 'my-test-agent'
 *   'RAG Helper!!!' → 'rag-helper'
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Mutable fields allowed in agent create/update requests. */
const AGENT_MUTABLE_FIELDS = [
  "name",
  "description",
  "system_prompt",
  "allowed_tools",
  "builtin_tools",
  "model",
  "visibility",
  "shared_with_teams",
  "subagents",
  "skills",
  "ui",
  "features",
  "interrupt_on",
  "enabled",
  "last_review",
] as const;

/**
 * Normalize a MongoDB agent document to the current schema.
 * Migrates legacy model_id/model_provider to model object.
 */
function normalizeAgentDoc(doc: Record<string, unknown>): Record<string, unknown> {
  // Migrate legacy model_id/model_provider → model
  if (doc.model_id && !doc.model) {
    doc.model = { id: doc.model_id, provider: doc.model_provider || "unknown" };
    delete doc.model_id;
    delete doc.model_provider;
  }
  return doc;
}

/**
 * Pick only allowed mutable fields from body, filtering out
 * undefined values. Prevents injection of server-controlled
 * fields like is_system, config_driven, owner_id.
 */
function pickMutableFields(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of AGENT_MUTABLE_FIELDS) {
    if (body[field] !== undefined) {
      result[field] = body[field];
    }
  }
  return result;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function teamIdString(team: TeamOwnershipDoc): string | undefined {
  if (team._id instanceof ObjectId) return team._id.toHexString();
  return normalizeString(team._id);
}

function isTeamAdmin(team: TeamOwnershipDoc, userEmail: string): boolean {
  const email = normalizeEmail(userEmail);
  return Boolean(
    email &&
      team.members?.some((member) => {
        const role = normalizeString(member.role)?.toLowerCase();
        return normalizeEmail(member.user_id ?? member.email) === email && (role === "admin" || role === "owner");
      }),
  );
}

async function loadOwnerTeam(ownerTeam: { slug?: string | null; id?: string | null }): Promise<TeamOwnershipDoc | null> {
  const teams = await getCollection<TeamOwnershipDoc>("teams");
  const filters: Record<string, unknown>[] = [];
  if (ownerTeam.slug) filters.push({ slug: ownerTeam.slug });
  if (ownerTeam.id) {
    filters.push({ _id: ownerTeam.id });
    if (ObjectId.isValid(ownerTeam.id)) filters.push({ _id: new ObjectId(ownerTeam.id) });
  }
  if (filters.length === 0) return null;
  return teams.findOne(filters.length === 1 ? filters[0] : { $or: filters });
}

/**
 * Validate that subagents have compatible visibility with parent.
 *
 * Rules:
 * - Private agent → can use private, team, or global subagents
 * - Team agent → can use team or global subagents
 * - Global agent → can only use global subagents
 */
async function validateSubagentVisibility(
  parentVisibility: VisibilityType,
  subagents: SubAgentRef[],
  collection: Collection<DynamicAgentConfig>,
): Promise<{ valid: boolean; error?: string }> {
  if (!subagents || subagents.length === 0) return { valid: true };

  for (const ref of subagents) {
    const sub = await collection.findOne({ _id: ref.agent_id });
    if (!sub) {
      return {
        valid: false,
        error: `Subagent "${ref.agent_id}" not found`,
      };
    }

    const subVis = sub.visibility as VisibilityType;

    // Global parent → only global subagents
    if (parentVisibility === "global" && subVis !== "global") {
      return {
        valid: false,
        error: `Global agents can only use global subagents. "${sub.name}" is ${subVis}.`,
      };
    }
    // Team parent → team or global subagents only
    if (parentVisibility === "team" && subVis === "private") {
      return {
        valid: false,
        error: `Team agents can only use team or global subagents. "${sub.name}" is private.`,
      };
    }
    // Private parent → any visibility (no restriction)
  }

  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════
// GET — list agents
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/dynamic-agents
 * List dynamic agents visible to the current user.
 *
 * Query params:
 * - enabled_only=true: Only return enabled agents (useful for subagent selection)
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);

    const collection =
      await getCollection<DynamicAgentConfig>(COLLECTION_NAME);
    const { page, pageSize, skip } = getPaginationParams(request);
    const { searchParams } = new URL(request.url);
    const enabledOnly = searchParams.get("enabled_only") === "true";

    const query: Record<string, unknown> = enabledOnly
      ? { $or: [{ enabled: true }, { enabled: { $exists: false } }] }
      : {};

    const [items, total] = await Promise.all([
      collection
        .find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(pageSize)
        .toArray(),
      collection.countDocuments(query),
    ]);

    // Normalize legacy documents
    const normalizedItems = items.map((item) =>
      normalizeAgentDoc(item as unknown as Record<string, unknown>),
    );
    const visibleItems = await filterResourcesByPermission(session, normalizedItems, {
      type: "agent",
      action: enabledOnly ? "use" : "discover",
      id: (agent) => String(agent._id),
    });

    return paginatedResponse(
      visibleItems,
      visibleItems.length < normalizedItems.length ? visibleItems.length : total,
      page,
      pageSize,
    );
});

// ═══════════════════════════════════════════════════════════════
// POST — create agent
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/dynamic-agents
 * Create a new dynamic agent configuration.
 * Requires admin role.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const { user, session } = await getAuthFromBearerOrSession(request);

    const body = await request.json();

    if (!body.name || typeof body.name !== "string") {
      throw new ApiError("Agent name is required", 400);
    }
    if (!body.system_prompt || typeof body.system_prompt !== "string") {
      throw new ApiError("System prompt is required", 400);
    }
    // Normalize legacy model_id/model_provider to model object
    if (body.model_id && !body.model) {
      body.model = { id: body.model_id, provider: body.model_provider || "unknown" };
      delete body.model_id;
      delete body.model_provider;
    }
    if (!body.model?.id || typeof body.model.id !== "string") {
      throw new ApiError("Model ID is required (model.id)", 400);
    }
    if (!body.model?.provider || typeof body.model.provider !== "string") {
      throw new ApiError("Model provider is required (model.provider)", 400);
    }
    const requestedOwnerTeamSlug = normalizeString(body.owner_team_slug);
    const requestedOwnerTeamId = normalizeString(body.owner_team_id);
    if (!requestedOwnerTeamSlug && !requestedOwnerTeamId) {
      throw new ApiError("Owner team is required", 400, "OWNER_TEAM_REQUIRED");
    }

    const ownerTeam = await loadOwnerTeam({ slug: requestedOwnerTeamSlug, id: requestedOwnerTeamId });
    if (!ownerTeam) {
      throw new ApiError("Owner team not found", 404, "OWNER_TEAM_NOT_FOUND");
    }
    const ownerTeamSlug = normalizeString(ownerTeam.slug);
    if (!ownerTeamSlug) {
      throw new ApiError("Owner team is missing a slug", 409, "OWNER_TEAM_INVALID");
    }

    const canManageAllAgents = await canManageOrganization(session);
    if (!canManageAllAgents && !isTeamAdmin(ownerTeam, user.email)) {
      throw new ApiError("You must be a platform admin or owner-team admin to create this agent", 403, "OWNER_TEAM_FORBIDDEN");
    }

    // Generate slug from name with agent- prefix
    const agentId = `agent-${slugify(body.name)}`;
    if (!agentId) {
      throw new ApiError("Agent name must contain at least one alphanumeric character", 400);
    }

    // Reserved slug check
    if (RESERVED_AGENT_SLUGS.has(agentId) || agentId.startsWith("__")) {
      throw new ApiError(`Agent name "${body.name}" is reserved`, 409);
    }

    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

    // Uniqueness check
    const existing = await collection.findOne({ _id: agentId });
    if (existing) {
      throw new ApiError(
        `Agent with ID "${agentId}" already exists`,
        409,
      );
    }

    // Subagent visibility validation
    const visibility: VisibilityType = body.visibility ?? "private";
    const subagents: SubAgentRef[] = body.subagents ?? [];
    if (subagents.length > 0) {
      const result = await validateSubagentVisibility(
        visibility,
        subagents,
        collection,
      );
      if (!result.valid) {
        throw new ApiError(result.error!, 400);
      }
    }

    // Build document with explicit field allowlist (Security VII)
    const now = new Date();
    const doc = {
      _id: agentId,
      name: body.name as string,
      description: (body.description as string) ?? "",
      system_prompt: body.system_prompt as string,
      allowed_tools: (body.allowed_tools as Record<string, string[]>) ?? {},
      builtin_tools: body.builtin_tools ?? undefined,
      model: body.model as { id: string; provider: string },
      visibility,
      shared_with_teams: (body.shared_with_teams as string[]) ?? [],
      owner_team_slug: ownerTeamSlug,
      owner_team_id: teamIdString(ownerTeam),
      subagents,
      skills: (body.skills as string[]) ?? [],
      ui: body.ui ?? undefined,
      features: body.features ?? undefined,
      interrupt_on: body.interrupt_on ?? undefined,
      enabled: (body.enabled as boolean) ?? true,
      // Server-controlled fields — never from request body
      owner_id: user.email,
      owner_subject: (session.sub as string | undefined) ?? user.email,
      is_system: false,
      config_driven: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    await reconcileAgentRelationships({
      agentId,
      previousAllowedTools: {},
      nextAllowedTools: doc.allowed_tools,
      ownerSubject: doc.owner_subject,
      organizationId: caipeOrgKey(),
      ownerTeamSlug,
    });

    try {
      await collection.insertOne(doc as any);
    } catch (error) {
      await deleteAllAgentToolTuples(agentId).catch((cleanupError) => {
        console.warn("[dynamic-agents] failed to clean up OpenFGA tuples after create failure:", cleanupError);
      });
      throw error;
    }

    return successResponse(doc, 201);
});

// ═══════════════════════════════════════════════════════════════
// PUT — update agent
// ═══════════════════════════════════════════════════════════════

/**
 * PUT /api/dynamic-agents?id=<agent_id>
 * Update a dynamic agent configuration.
 * Requires admin role. Config-driven agents cannot be modified.
 */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Agent ID is required", 400);
  }

  const { session } = await getAuthFromBearerOrSession(request);
  await requireResourcePermission(session, { type: "agent", id, action: "write" });

    const body = await request.json();
    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

    // Verify agent exists
    const agent = await collection.findOne({ _id: id });
    if (!agent) {
      throw new ApiError("Agent not found", 404);
    }

    // Config-driven guard
    if (agent.config_driven) {
      throw new ApiError(
        "Config-driven agents cannot be modified. Update config.yaml instead.",
        403,
      );
    }

    // Build update with explicit field allowlist
    const updateData = pickMutableFields(body);
    if (Object.keys(updateData).length === 0) {
      // No fields to update — return current state
      return successResponse(agent);
    }

    // Subagent visibility validation (using merged final values)
    const finalVisibility = (updateData.visibility ??
      agent.visibility) as VisibilityType;
    const finalSubagents = (updateData.subagents ??
      agent.subagents ??
      []) as SubAgentRef[];

    if (finalSubagents.length > 0) {
      const result = await validateSubagentVisibility(
        finalVisibility,
        finalSubagents,
        collection,
      );
      if (!result.valid) {
        throw new ApiError(result.error!, 400);
      }
    }

    updateData.updated_at = new Date().toISOString();

    const finalAllowedTools = (updateData.allowed_tools ??
      agent.allowed_tools ??
      {}) as Record<string, string[]>;
    await reconcileAgentRelationships({
      agentId: id,
      previousAllowedTools: allowedToolsFromAgent(agent),
      nextAllowedTools: finalAllowedTools,
      ownerSubject: agent.owner_subject ?? agent.owner_id,
      organizationId: caipeOrgKey(),
      ownerTeamSlug: agent.owner_team_slug,
    });

    const updated = await collection.findOneAndUpdate(
      { _id: id },
      { $set: updateData },
      { returnDocument: "after" },
    );

    if (!updated) {
      throw new ApiError("Failed to update agent", 500);
    }

    return successResponse(normalizeAgentDoc(updated as unknown as Record<string, unknown>));
});

// ═══════════════════════════════════════════════════════════════
// DELETE — delete agent
// ═══════════════════════════════════════════════════════════════

/**
 * DELETE /api/dynamic-agents?id=<agent_id>
 * Delete a dynamic agent configuration.
 * Requires admin role. System and config-driven agents cannot be deleted.
 */
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Agent ID is required", 400);
  }

  const { session } = await getAuthFromBearerOrSession(request);
  await requireResourcePermission(session, { type: "agent", id, action: "delete" });

    const collection = await getCollection<DynamicAgentConfig>(COLLECTION_NAME);

    // Verify agent exists
    const agent = await collection.findOne({ _id: id });
    if (!agent) {
      throw new ApiError("Agent not found", 404);
    }

    // System agent guard
    if (agent.is_system) {
      throw new ApiError("System agents cannot be deleted", 400);
    }

    // Config-driven guard
    if (agent.config_driven) {
      throw new ApiError(
        "Config-driven agents cannot be deleted. Remove from config.yaml instead.",
        403,
      );
    }

    await deleteAllAgentToolTuples(id);
    await collection.deleteOne({ _id: id });

    return successResponse({ deleted: id });
});
