/**
 * API routes for MCP Server management.
 *
 * All operations use local MongoDB directly.
 * The gateway owns all config writes — DA is a pure runtime reader.
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withErrorHandler,
  successResponse,
  ApiError,
  getPaginationParams,
  paginatedResponse,
  getAuthFromBearerOrSession,
} from "@/lib/api-middleware";
import {
  filterResourcesByPermission,
  requireResourcePermission,
} from "@/lib/rbac/resource-authz";
import {
  deleteAllMcpServerRelationshipTuples,
  reconcileMcpServerRelationships,
} from "@/lib/rbac/openfga-owned-resources";
import type { MCPServerConfig, TransportType } from "@/types/dynamic-agent";

const COLLECTION_NAME = "mcp_servers";

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/** Mutable fields allowed in MCP server create/update requests. */
const SERVER_MUTABLE_FIELDS = [
  "name",
  "description",
  "transport",
  "endpoint",
  "command",
  "args",
  "env",
  "credential_sources",
  "enabled",
] as const;

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireStableSubject(session: { sub?: unknown }): string {
  const subject = normalizeString(session.sub);
  if (!subject) {
    throw new ApiError("A stable user subject is required for MCP server ownership.", 401, "NO_SUBJECT");
  }
  return subject;
}

/**
 * Pick only allowed mutable fields from body, filtering out
 * undefined values. Prevents injection of server-controlled
 * fields like config_driven.
 */
function pickMutableFields(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of SERVER_MUTABLE_FIELDS) {
    if (body[field] !== undefined) {
      result[field] = body[field];
    }
  }
  return result;
}

/**
 * Validate transport-specific required fields.
 *
 * - stdio: requires `command`
 * - sse/http: requires `endpoint`
 */
function validateTransportConfig(
  transport: TransportType,
  command?: string,
  endpoint?: string,
): void {
  if (transport === "stdio") {
    if (!command) {
      throw new ApiError("'command' is required for stdio transport", 400);
    }
  } else if (transport === "sse" || transport === "http") {
    if (!endpoint) {
      throw new ApiError("'endpoint' is required for sse/http transport", 400);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// GET — list MCP servers
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/mcp-servers
 * List MCP server configurations visible to the current user.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);

    const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);
    const { page, pageSize, skip } = getPaginationParams(request);

    const [items] = await Promise.all([
      collection.find({}).sort({ name: 1 }).skip(skip).limit(pageSize).toArray(),
      collection.countDocuments({}),
    ]);
    const listTarget = {
      type: "mcp_server" as const,
      action: "read" as const,
      id: (server: MCPServerConfig) => String(server._id),
    };
    const visibleItems = await filterResourcesByPermission(session, items, listTarget);

    return paginatedResponse(visibleItems, visibleItems.length, page, pageSize);
});

// ═══════════════════════════════════════════════════════════════
// POST — create MCP server
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/mcp-servers
 * Create a new MCP server configuration.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session, user } = await getAuthFromBearerOrSession(request);
  const ownerSubject = requireStableSubject(session);

    const body = await request.json();

    if (!body.id || typeof body.id !== "string") {
      throw new ApiError("Server ID is required", 400);
    }
    if (!body.name || typeof body.name !== "string") {
      throw new ApiError("Server name is required", 400);
    }
    if (!body.transport || typeof body.transport !== "string") {
      throw new ApiError("Transport type is required", 400);
    }

    const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);

    // Silently prepend mcp- prefix to user-provided ID
    const serverId = body.id.startsWith("mcp-") ? body.id as string : `mcp-${body.id as string}`;
    const ownerTeamSlug = normalizeString(body.owner_team_slug);
    if (ownerTeamSlug) {
      await requireResourcePermission(session, { type: "team", id: ownerTeamSlug, action: "use" });
    }

    // Uniqueness check
    const existing = await collection.findOne({ _id: serverId });
    if (existing) {
      throw new ApiError(
        `MCP server with ID '${serverId}' already exists`,
        409,
      );
    }

    // Transport validation
    validateTransportConfig(
      body.transport as TransportType,
      body.command as string | undefined,
      body.endpoint as string | undefined,
    );

    // Build document with explicit field allowlist (Security VII)
    const now = new Date();
    const doc: MCPServerConfig = {
      _id: serverId,
      name: body.name as string,
      description: (body.description as string) ?? "",
      transport: body.transport as TransportType,
      endpoint: body.endpoint as string | undefined,
      command: body.command as string | undefined,
      args: body.args as string[] | undefined,
      env: body.env as Record<string, string> | undefined,
      credential_sources: Array.isArray(body.credential_sources) ? body.credential_sources : undefined,
      enabled: (body.enabled as boolean) ?? true,
      owner_id: user.email,
      owner_subject: ownerSubject,
      owner_team_slug: ownerTeamSlug ?? undefined,
      // Server-controlled — never from request body
      config_driven: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    await reconcileMcpServerRelationships({
      serverId,
      ownerSubject,
      ownerTeamSlug,
    });

    await collection.insertOne(doc);

    return successResponse(doc, 201);
});

// ═══════════════════════════════════════════════════════════════
// PUT — update MCP server
// ═══════════════════════════════════════════════════════════════

/**
 * PUT /api/mcp-servers?id=<server_id>
 * Update an MCP server configuration.
 * Requires resource write access. Config-driven servers cannot be modified.
 */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Server ID is required", 400);
  }

  const { session } = await getAuthFromBearerOrSession(request);

    const body = await request.json();
    const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);

    // Verify server exists
    const server = await collection.findOne({ _id: id });
    if (!server) {
      throw new ApiError("MCP server not found", 404);
    }
    const updateTarget = {
      type: "mcp_server" as const,
      id,
      action: "write" as const,
    };
    await requireResourcePermission(session, updateTarget);

    // Config-driven guard
    if (server.config_driven) {
      throw new ApiError(
        "Config-driven MCP servers cannot be modified. Update config.yaml instead.",
        403,
      );
    }

    // Build update with explicit field allowlist
    const updateData = pickMutableFields(body);
    if (Object.keys(updateData).length === 0) {
      // No fields to update — return current state
      return successResponse(server);
    }

    updateData.updated_at = new Date().toISOString();

    const updated = await collection.findOneAndUpdate(
      { _id: id },
      { $set: updateData },
      { returnDocument: "after" },
    );

    if (!updated) {
      throw new ApiError("Failed to update MCP server", 500);
    }

    return successResponse(updated);
});

// ═══════════════════════════════════════════════════════════════
// DELETE — delete MCP server
// ═══════════════════════════════════════════════════════════════

/**
 * DELETE /api/mcp-servers?id=<server_id>
 * Delete an MCP server configuration.
 * Requires resource delete access. Config-driven servers cannot be deleted.
 */
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Server ID is required", 400);
  }

  const { session } = await getAuthFromBearerOrSession(request);

    const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);

    // Verify server exists
    const server = await collection.findOne({ _id: id });
    if (!server) {
      throw new ApiError("MCP server not found", 404);
    }
    const deleteTarget = {
      type: "mcp_server" as const,
      id,
      action: "delete" as const,
    };
    await requireResourcePermission(session, deleteTarget);

    // Config-driven guard
    if (server.config_driven) {
      throw new ApiError(
        "Config-driven MCP servers cannot be deleted. Remove from config.yaml instead.",
        403,
      );
    }

    await deleteAllMcpServerRelationshipTuples(id);
    await collection.deleteOne({ _id: id });

    return successResponse({ deleted: id });
});
