/**
 * API routes for MCP Server management.
 *
 * All operations use local MongoDB directly.
 * The gateway owns all config writes — DA is a pure runtime reader.
 */

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  requireAdmin,
  getPaginationParams,
  paginatedResponse,
} from "@/lib/api-middleware";
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
  "enabled",
] as const;

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
 * List all MCP server configurations.
 * Requires admin role.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);
    const { page, pageSize, skip } = getPaginationParams(request);

    const [items, total] = await Promise.all([
      collection.find({}).sort({ name: 1 }).skip(skip).limit(pageSize).toArray(),
      collection.countDocuments({}),
    ]);

    return paginatedResponse(items, total, page, pageSize);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST — create MCP server
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/mcp-servers
 * Create a new MCP server configuration.
 * Requires admin role.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

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

    // Uniqueness check
    const existing = await collection.findOne({ _id: body.id });
    if (existing) {
      throw new ApiError(
        `MCP server with ID '${body.id}' already exists`,
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
    const doc = {
      _id: body.id as string,
      name: body.name as string,
      description: (body.description as string) ?? "",
      transport: body.transport as TransportType,
      endpoint: body.endpoint ?? undefined,
      command: body.command ?? undefined,
      args: body.args ?? undefined,
      env: body.env ?? undefined,
      enabled: (body.enabled as boolean) ?? true,
      // Server-controlled — never from request body
      config_driven: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    await collection.insertOne(doc as any);

    return successResponse(doc, 201);
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT — update MCP server
// ═══════════════════════════════════════════════════════════════

/**
 * PUT /api/mcp-servers?id=<server_id>
 * Update an MCP server configuration.
 * Requires admin role. Config-driven servers cannot be modified.
 */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Server ID is required", 400);
  }

  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const body = await request.json();
    const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);

    // Verify server exists
    const server = await collection.findOne({ _id: id });
    if (!server) {
      throw new ApiError("MCP server not found", 404);
    }

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
});

// ═══════════════════════════════════════════════════════════════
// DELETE — delete MCP server
// ═══════════════════════════════════════════════════════════════

/**
 * DELETE /api/mcp-servers?id=<server_id>
 * Delete an MCP server configuration.
 * Requires admin role. Config-driven servers cannot be deleted.
 */
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Server ID is required", 400);
  }

  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);

    // Verify server exists
    const server = await collection.findOne({ _id: id });
    if (!server) {
      throw new ApiError("MCP server not found", 404);
    }

    // Config-driven guard
    if (server.config_driven) {
      throw new ApiError(
        "Config-driven MCP servers cannot be deleted. Remove from config.yaml instead.",
        403,
      );
    }

    await collection.deleteOne({ _id: id });

    return successResponse({ deleted: id });
  });
});
