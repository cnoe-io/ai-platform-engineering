import { createHash, randomUUID } from "crypto";
import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type {
  UserMemory,
  UserMemoryCategory,
  UserMemoryScope,
} from "@/types/mongodb";

const VALID_SCOPES = new Set<UserMemoryScope>(["global", "agent", "context"]);
const VALID_CATEGORIES = new Set<UserMemoryCategory>([
  "preference",
  "instruction",
  "fact",
  "formatting",
]);
const MAX_VALUE_LENGTH = 4000;

function normalizeKey(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.slice(0, 96) || "memory";
}

function fallbackKey(category: string, value: string): string {
  const digest = createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 12);
  return `${normalizeKey(category)}_${digest}`;
}

function makeMemoryId(): string {
  return `mem_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function validateScope(value: unknown): UserMemoryScope {
  if (typeof value !== "string" || !VALID_SCOPES.has(value as UserMemoryScope)) {
    throw new ApiError("scope must be one of: global, agent, context", 400);
  }
  return value as UserMemoryScope;
}

function validateCategory(value: unknown): UserMemoryCategory {
  if (!value) return "preference";
  if (typeof value !== "string" || !VALID_CATEGORIES.has(value as UserMemoryCategory)) {
    return "preference";
  }
  return value as UserMemoryCategory;
}

function validateValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("value is required", 400);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_VALUE_LENGTH) {
    throw new ApiError(`value must be <= ${MAX_VALUE_LENGTH} characters`, 400);
  }
  return trimmed;
}

async function memoriesCollection() {
  if (!isMongoDBConfigured) {
    throw new ApiError("Memory storage requires MongoDB to be configured", 503);
  }
  return getCollection<UserMemory>("user_memories");
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user } = await getAuthFromBearerOrSession(request);
  const collection = await memoriesCollection();
  const url = new URL(request.url);

  const query: Record<string, unknown> = { owner_user_id: user.email };
  const ids = url.searchParams.get("ids");
  if (ids) {
    query._id = { $in: ids.split(",").map((id) => id.trim()).filter(Boolean) };
  }

  const scope = url.searchParams.get("scope");
  if (scope) query.scope = validateScope(scope);

  for (const field of ["agent_id", "context_namespace", "context_type", "context_id"]) {
    const value = url.searchParams.get(field);
    if (value) query[field] = value;
  }

  if (url.searchParams.get("include_disabled") === "false") {
    query.enabled = true;
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 200);
  const items = await collection.find(query).sort({ updated_at: -1 }).limit(limit).toArray();
  return successResponse({ items });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { user } = await getAuthFromBearerOrSession(request);
  const collection = await memoriesCollection();
  const body = await request.json();

  const scope = validateScope(body.scope);
  const category = validateCategory(body.category);
  const value = validateValue(body.value);

  const agentId = scope === "agent" ? String(body.agent_id || "") : null;
  const contextNamespace = scope === "context" ? String(body.context_namespace || "") : null;
  const contextType = scope === "context" ? String(body.context_type || "") : null;
  const contextId = scope === "context" ? String(body.context_id || "") : null;

  if (scope === "agent" && !agentId) {
    throw new ApiError("agent_id is required for agent memory", 400);
  }
  if (scope === "context" && (!contextNamespace || !contextType || !contextId)) {
    throw new ApiError("context_namespace, context_type, and context_id are required for context memory", 400);
  }

  const normalizedKey = body.key ? normalizeKey(String(body.key)) : fallbackKey(category, value);
  const now = new Date();
  const memoryId = makeMemoryId();

  const filter = {
    owner_user_id: user.email,
    scope,
    agent_id: agentId,
    context_namespace: contextNamespace,
    context_type: contextType,
    context_id: contextId,
    normalized_key: normalizedKey,
  };

  const result = await collection.findOneAndUpdate(
    filter,
    {
      $set: {
        owner_user_id: user.email,
        scope,
        agent_id: agentId,
        context_namespace: contextNamespace,
        context_type: contextType,
        context_id: contextId,
        category,
        key: body.key ? String(body.key) : normalizedKey,
        normalized_key: normalizedKey,
        value,
        enabled: body.enabled === undefined ? true : Boolean(body.enabled),
        source: "manual",
        updated_at: now,
      },
      $setOnInsert: {
        _id: memoryId,
        memory_id: memoryId,
        created_at: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  return successResponse({ memory: result }, 201);
});

export const PATCH = withErrorHandler(async (request: NextRequest) => {
  const { user } = await getAuthFromBearerOrSession(request);
  const collection = await memoriesCollection();
  const body = await request.json();
  const memoryId = String(body.memory_id || body.id || "");
  if (!memoryId) throw new ApiError("memory_id is required", 400);

  const update: Record<string, unknown> = { updated_at: new Date() };
  if (body.value !== undefined) update.value = validateValue(body.value);
  if (body.category !== undefined) update.category = validateCategory(body.category);
  if (body.key !== undefined) {
    update.key = String(body.key);
    update.normalized_key = normalizeKey(String(body.key));
  }
  if (body.enabled !== undefined) update.enabled = Boolean(body.enabled);

  const result = await collection.findOneAndUpdate(
    { _id: memoryId, owner_user_id: user.email },
    { $set: update },
    { returnDocument: "after" },
  );
  if (!result) throw new ApiError("Memory not found", 404);
  return successResponse({ memory: result });
});

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const { user } = await getAuthFromBearerOrSession(request);
  const collection = await memoriesCollection();
  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const memoryId = String(url.searchParams.get("memory_id") || body.memory_id || body.id || "");
  if (!memoryId) throw new ApiError("memory_id is required", 400);

  const result = await collection.deleteOne({ _id: memoryId, owner_user_id: user.email });
  if (result.deletedCount === 0) throw new ApiError("Memory not found", 404);
  return successResponse({ deleted: true, memory_id: memoryId });
});
