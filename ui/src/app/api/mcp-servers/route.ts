/**
 * API routes for MCP Server management.
 *
 * env and headers values are envelope-encrypted at rest.
 * GET responses mask them (keys visible, values hidden).
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
import { encryptSecret, MASKED_SECRET } from "@/lib/crypto";
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
  "headers",
  "command",
  "args",
  "env",
  "enabled",
] as const;

/**
 * Mask all values in a key→value dict for safe API responses.
 * Keys are visible; values are replaced with MASKED_SECRET.
 */
function maskValues(
  dict: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!dict) return dict;
  const masked: Record<string, string> = {};
  for (const key of Object.keys(dict)) {
    masked[key] = MASKED_SECRET;
  }
  return masked;
}

/**
 * Encrypt all values in a key→value dict using envelope encryption.
 * Returns undefined if the input is falsy.
 */
function encryptValues(
  dict: Record<string, string> | undefined,
): Record<string, unknown> | undefined {
  if (!dict || Object.keys(dict).length === 0) return undefined;
  const encrypted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dict)) {
    if (v) encrypted[k] = encryptSecret(v);
  }
  return encrypted;
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
 * List all MCP server configurations.
 * Requires admin role. Sensitive env and header values are masked.
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

    // Mask env and header values — keys visible, secrets hidden
    const safeItems = items.map((item) => ({
      ...item,
      env: maskValues(item.env as Record<string, string> | undefined),
      headers: maskValues((item as any).headers as Record<string, string> | undefined),
    }));

    return paginatedResponse(safeItems, total, page, pageSize);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST — create MCP server
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/mcp-servers
 * Create a new MCP server configuration.
 * Requires admin role. env and headers values are encrypted before storage.
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
      throw new ApiError(`MCP server with ID '${body.id}' already exists`, 409);
    }

    // Transport validation
    validateTransportConfig(
      body.transport as TransportType,
      body.command as string | undefined,
      body.endpoint as string | undefined,
    );

    // Encrypt sensitive values before storage
    const encryptedEnv = encryptValues(body.env as Record<string, string> | undefined);
    const encryptedHeaders = encryptValues(body.headers as Record<string, string> | undefined);

    const now = new Date();
    const doc = {
      _id: body.id as string,
      name: body.name as string,
      description: (body.description as string) ?? "",
      transport: body.transport as TransportType,
      endpoint: body.endpoint ?? undefined,
      headers: encryptedHeaders ?? undefined,
      headers_encrypted: !!encryptedHeaders,
      command: body.command ?? undefined,
      args: body.args ?? undefined,
      env: encryptedEnv ?? undefined,
      env_encrypted: !!encryptedEnv,
      enabled: (body.enabled as boolean) ?? true,
      config_driven: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    await collection.insertOne(doc as any);

    return successResponse(
      { ...doc, env: maskValues(body.env), headers: maskValues(body.headers) },
      201,
    );
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

    const server = await collection.findOne({ _id: id });
    if (!server) {
      throw new ApiError("MCP server not found", 404);
    }

    if (server.config_driven) {
      throw new ApiError(
        "Config-driven MCP servers cannot be modified. Update the seed config instead.",
        403,
      );
    }

    const updateData = pickMutableFields(body);

    // Encrypt env / headers if provided (skip masked placeholder values)
    if (updateData.env && typeof updateData.env === "object") {
      const raw = updateData.env as Record<string, string>;
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v && v !== MASKED_SECRET) cleaned[k] = v;
      }
      if (Object.keys(cleaned).length > 0) {
        updateData.env = encryptValues(cleaned) as any;
        updateData.env_encrypted = true;
      } else {
        delete updateData.env;
      }
    }

    if (updateData.headers && typeof updateData.headers === "object") {
      const raw = updateData.headers as Record<string, string>;
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v && v !== MASKED_SECRET) cleaned[k] = v;
      }
      if (Object.keys(cleaned).length > 0) {
        updateData.headers = encryptValues(cleaned) as any;
        updateData.headers_encrypted = true;
      } else {
        delete updateData.headers;
      }
    }

    if (Object.keys(updateData).length === 0) {
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

    return successResponse({
      ...updated,
      env: maskValues((updated as any).env),
      headers: maskValues((updated as any).headers),
    });
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

    const server = await collection.findOne({ _id: id });
    if (!server) {
      throw new ApiError("MCP server not found", 404);
    }

    if (server.config_driven) {
      throw new ApiError(
        "Config-driven MCP servers cannot be deleted. Remove from seed config instead.",
        403,
      );
    }

    await collection.deleteOne({ _id: id });

    return successResponse({ deleted: id });
  });
});
