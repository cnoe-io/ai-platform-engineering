/**
 * API routes for MCP Server management.
 */

import { NextRequest, NextResponse } from "next/server";
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
import type {
  MCPServerConfig,
  MCPServerConfigCreate,
  MCPServerConfigUpdate,
} from "@/types/dynamic-agent";

const COLLECTION_NAME = "mcp_servers";

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

/**
 * POST /api/mcp-servers
 * Create a new MCP server configuration.
 * Requires admin role.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const body: MCPServerConfigCreate = await request.json();

    // Validate required fields
    if (!body.id || !body.name || !body.transport) {
      throw new ApiError("Missing required fields: id, name, transport", 400);
    }

    // Validate transport-specific fields
    if (body.transport === "stdio" && !body.command) {
      throw new ApiError("'command' is required for stdio transport", 400);
    }
    if ((body.transport === "sse" || body.transport === "http") && !body.endpoint) {
      throw new ApiError("'endpoint' is required for sse/http transport", 400);
    }

    const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);

    // Check if ID already exists
    const existing = await collection.findOne({ _id: body.id });
    if (existing) {
      throw new ApiError(`MCP server with ID '${body.id}' already exists`, 409);
    }

    const now = new Date();

    const newServer: MCPServerConfig = {
      _id: body.id,
      name: body.name,
      description: body.description,
      transport: body.transport,
      endpoint: body.endpoint,
      command: body.command,
      args: body.args,
      env: body.env,
      enabled: body.enabled ?? true,
      created_at: now,
      updated_at: now,
    };

    await collection.insertOne(newServer as any);

    return successResponse(newServer, 201);
  });
});

/**
 * PUT /api/mcp-servers?id=<server_id>
 * Update an MCP server configuration.
 * Requires admin role.
 */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Server ID is required", 400);
  }

  return await withAuth(request, async (req, user, session) => {
    requireAdmin(session);

    const body: MCPServerConfigUpdate = await request.json();
    const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);

    // Check if server exists
    const existing = await collection.findOne({ _id: id });
    if (!existing) {
      throw new ApiError("MCP server not found", 404);
    }

    // Build update
    const updateFields: any = {
      updated_at: new Date(),
    };

    if (body.name !== undefined) updateFields.name = body.name;
    if (body.description !== undefined) updateFields.description = body.description;
    if (body.transport !== undefined) updateFields.transport = body.transport;
    if (body.endpoint !== undefined) updateFields.endpoint = body.endpoint;
    if (body.command !== undefined) updateFields.command = body.command;
    if (body.args !== undefined) updateFields.args = body.args;
    if (body.env !== undefined) updateFields.env = body.env;
    if (body.enabled !== undefined) updateFields.enabled = body.enabled;

    await collection.updateOne({ _id: id }, { $set: updateFields });

    const updated = await collection.findOne({ _id: id });
    return successResponse(updated);
  });
});

/**
 * DELETE /api/mcp-servers?id=<server_id>
 * Delete an MCP server configuration.
 * Requires admin role.
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

    // Check if server exists
    const existing = await collection.findOne({ _id: id });
    if (!existing) {
      throw new ApiError("MCP server not found", 404);
    }

    await collection.deleteOne({ _id: id });

    return successResponse({ deleted: id });
  });
});
