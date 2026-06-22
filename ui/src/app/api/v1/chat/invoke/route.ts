/**
 * POST /api/v1/chat/invoke — transparent proxy to Dynamic Agents.
 *
 * Body: { message, conversation_id, agent_id, trace_id?, client_context? }
 * Response: JSON { success, content, agent_id, conversation_id, trace_id }
 */

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { createAuthzTraceContext, type AuthzTraceContext } from "@/lib/rbac/authz-tracing";
import { requireAgentUsePermission } from "@/lib/rbac/openfga-agent-authz";
import {
  isSchedulerTokenConfigured,
  isSchedulerTokenValid,
  mintScheduledOwnerToken,
  resolveScheduledRunOwner,
} from "@/lib/scheduled-run-auth";
import { buildParticipants } from "@/types/a2a";
import type { Conversation } from "@/types/mongodb";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireConversationWriteAccess } from "../_conversation-authz";
import {
  authenticateRequest,
  getDynamicAgentsConfig,
  proxyJSONRequest,
  type AuthResult,
  type DynamicAgentsConfig,
} from "../_helpers";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes — invoke runs the full agent loop

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function truncateForTitle(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function metadataSetFields(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [`metadata.${key}`, value]),
  );
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  );
}

async function ensureScheduledConversation(
  body: Record<string, unknown>,
  ownerUserId: string,
): Promise<string | null> {
  if (!isMongoDBConfigured) return null;

  const requestedConversationId = stringValue(body.conversation_id);
  const agentId = stringValue(body.agent_id);

  if (!requestedConversationId || !agentId || !ownerUserId) return null;

  const clientContext = objectValue(body.client_context);
  const scheduleId = stringValue(clientContext.schedule_id);
  const scheduleTitle = stringValue(clientContext.schedule_title);
  const podId = stringValue(clientContext.pod_id);
  const traceId = stringValue(body.trace_id) || requestedConversationId;
  const now = new Date();

  const conversations = await getCollection<Conversation>("conversations");
  const idempotencyKey = `scheduler:${requestedConversationId}`;
  const existing = await conversations.findOne({
    $or: [
      { idempotency_key: idempotencyKey },
      ...(UUID_RE.test(requestedConversationId) ? [{ _id: requestedConversationId }] : []),
    ],
  });

  const conversationId = existing?._id || (
    UUID_RE.test(requestedConversationId) ? requestedConversationId : uuidv4()
  );

  const titlePreview = truncateForTitle(String(body.message || ""), 72);
  const title = titlePreview
    ? `Scheduled: ${titlePreview}`
    : `Scheduled run${scheduleId ? ` ${scheduleId}` : ""}`;

  const schedulerMetadata = {
    source: "scheduler",
    schedule_id: scheduleId,
    schedule_title: scheduleTitle,
    pod_id: podId,
    requested_conversation_id: requestedConversationId,
    trace_id: traceId,
    owner_user_id: ownerUserId,
  };

  await conversations.updateOne(
    { _id: conversationId },
    {
      $setOnInsert: {
        _id: conversationId,
        title,
        owner_id: ownerUserId,
        idempotency_key: idempotencyKey,
        participants: buildParticipants(agentId, ownerUserId),
        created_at: now,
        "metadata.total_messages": 0,
        sharing: {
          is_public: false,
          shared_with: [],
          shared_with_teams: [],
          share_link_enabled: false,
        },
        tags: ["scheduled"],
        is_archived: false,
        is_pinned: false,
      },
      $set: {
        updated_at: now,
        client_type: "webui",
        agent_id: agentId,
        ...metadataSetFields(schedulerMetadata),
      },
    } as any,
    { upsert: true },
  );

  return conversationId;
}

async function persistScheduledInvokeMessages(
  body: Record<string, unknown>,
  ownerUserId: string,
  response: Response,
): Promise<void> {
  if (!isMongoDBConfigured) return;

  const conversationId = stringValue(body.conversation_id);
  const userContent = String(body.message || "").trim();
  if (!conversationId || !userContent) return;

  let result: Record<string, unknown> | null = null;
  try {
    const parsed = await response.json();
    result = objectValue(parsed);
  } catch (error) {
    console.warn("[invoke] Scheduled run response was not JSON; skipping message persistence", error);
    return;
  }

  const agentId = stringValue(body.agent_id);
  const clientContext = objectValue(body.client_context);
  const scheduleId = stringValue(clientContext.schedule_id);
  const scheduleTitle = stringValue(clientContext.schedule_title);
  const traceId = stringValue(body.trace_id) || conversationId;
  const turnId = `turn-${traceId}`;
  const succeeded = result.success !== false && response.ok;
  const assistantContent =
    stringValue(result.content) ||
    stringValue(result.error) ||
    (succeeded ? "" : "Scheduled run failed.");

  const messages = await getCollection<any>("messages");
  const conversations = await getCollection<Conversation>("conversations");
  const userCreatedAt = new Date();
  const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1);
  const commonMetadata = {
    turn_id: turnId,
    source: "scheduler",
    schedule_id: scheduleId,
    schedule_title: scheduleTitle,
    trace_id: traceId,
    agent_id: agentId,
  };
  const messageMetadata = compactMetadata(commonMetadata);

  await messages.updateOne(
    { conversation_id: conversationId, message_id: `${turnId}-user` },
    {
      $set: {
        content: userContent,
        metadata: {
          ...messageMetadata,
          is_final: true,
        },
        updated_at: userCreatedAt,
      },
      $setOnInsert: {
        message_id: `${turnId}-user`,
        conversation_id: conversationId,
        role: "user",
        created_at: userCreatedAt,
        ...(ownerUserId && {
          owner_id: ownerUserId,
          sender_email: ownerUserId,
          sender_name: ownerUserId,
        }),
      },
    },
    { upsert: true },
  );

  if (assistantContent) {
    await messages.updateOne(
      { conversation_id: conversationId, message_id: `${turnId}-assistant` },
      {
        $set: {
          content: assistantContent,
          metadata: {
            ...messageMetadata,
            is_final: true,
            turn_status: succeeded ? "done" : "interrupted",
          },
          updated_at: assistantCreatedAt,
        },
        $setOnInsert: {
          message_id: `${turnId}-assistant`,
          conversation_id: conversationId,
          role: "assistant",
          created_at: assistantCreatedAt,
          ...(ownerUserId && { owner_id: ownerUserId }),
        },
      },
      { upsert: true },
    );
  }

  const totalMessages = await messages.countDocuments({ conversation_id: conversationId });
  await conversations.updateOne(
    { _id: conversationId },
    {
      $set: {
        updated_at: assistantCreatedAt,
        "metadata.total_messages": totalMessages,
        "metadata.last_run_at": assistantCreatedAt,
        "metadata.last_status": succeeded ? "ok" : "error",
      },
    },
  );
}

/**
 * Build the base64 ``X-User-Context`` header DA expects for the schedule owner.
 * Mirrors the shape produced by ``authenticateRequest`` for interactive users
 * (DA treats these flags as opaque pass-through for the ``user_info`` tool).
 */
function ownerUserContextHeader(email: string): string {
  const userContext = {
    email,
    name: email,
    is_admin: false,
    is_authorized: true,
    can_view_admin: false,
    can_access_dynamic_agents: true,
  };
  return Buffer.from(JSON.stringify(userContext)).toString("base64");
}

/**
 * Handle a scheduled cron fire (scheduled-job-auth Approach 2).
 *
 * The request is authenticated by the shared ``X-Scheduler-Token`` only — it
 * carries no user identity we trust. We resolve the immutable owner from the
 * schedule DB record, mint a real owner bearer via Keycloak token exchange, and
 * then run the SAME agent#use gate an interactive owner run would (no DA
 * scheduled-run auth bypass). Any failure to resolve the owner, mint the token,
 * or pass agent#use fails the run closed.
 */
async function handleScheduledInvoke(
  request: NextRequest,
  body: Record<string, unknown>,
  daConfig: DynamicAgentsConfig,
  traceContext: AuthzTraceContext,
): Promise<Response> {
  if (!isSchedulerTokenConfigured()) {
    console.error("[invoke] Scheduled run received but SCHEDULER_SERVICE_TOKEN is not configured");
    return NextResponse.json(
      { success: false, error: "Scheduler service token is not configured" },
      { status: 500 },
    );
  }
  if (!isSchedulerTokenValid(request.headers.get("X-Scheduler-Token"))) {
    return NextResponse.json(
      { success: false, error: "Invalid scheduler authentication" },
      { status: 401 },
    );
  }

  const clientContext = objectValue(body.client_context);
  const scheduleId = stringValue(clientContext.schedule_id);
  if (!scheduleId) {
    return NextResponse.json(
      { success: false, error: "Scheduled run missing client_context.schedule_id" },
      { status: 400 },
    );
  }

  // Owner is resolved ONLY from the schedule DB record, never from a
  // runner-supplied field. Missing schedule/owner → fail closed.
  let owner: Awaited<ReturnType<typeof resolveScheduledRunOwner>>;
  try {
    owner = await resolveScheduledRunOwner(scheduleId);
  } catch (error) {
    console.error(`[invoke] Failed to resolve owner for schedule ${scheduleId}:`, error);
    return NextResponse.json(
      { success: false, error: "Could not resolve schedule owner" },
      { status: 502 },
    );
  }
  if (!owner) {
    return NextResponse.json(
      { success: false, error: "Schedule owner could not be resolved" },
      { status: 403 },
    );
  }

  // Mint the owner-user bearer via Keycloak token exchange. Failure (owner
  // disabled, exchange misconfigured) → fail closed.
  let ownerToken: string;
  try {
    ownerToken = await mintScheduledOwnerToken(owner.sub);
  } catch (error) {
    console.error(`[invoke] Failed to mint owner token for schedule ${scheduleId}:`, error);
    return NextResponse.json(
      { success: false, error: "Could not mint owner credentials for scheduled run" },
      { status: 502 },
    );
  }

  const authResult: AuthResult = {
    subject: owner.sub,
    email: owner.email || undefined,
    role: "user",
    tenantId: "default",
    bearerToken: ownerToken,
    isServiceAccount: false,
    traceparent: traceContext.traceparent,
    userContextHeader: ownerUserContextHeader(owner.email),
  };

  // Enforce agent#use as the owner — the same gate as an interactive run, so a
  // run fails closed if the owner has lost access to the agent.
  const authzResponse = await requireAgentUsePermission({
    subject: owner.sub,
    agentId: body.agent_id,
    email: owner.email,
    tenantId: "default",
    traceparent: traceContext.traceparent,
    isServiceAccount: false,
  });
  if (authzResponse) return authzResponse;

  // The scheduled conversation may not exist until this branch idempotently
  // creates it (owned by the resolved owner), so we own its creation and skip
  // the interactive conversation-write gate.
  let shouldPersistScheduledMessages = false;
  try {
    const conversationId = await ensureScheduledConversation(body, owner.email);
    if (conversationId) {
      body = { ...body, conversation_id: conversationId };
      shouldPersistScheduledMessages = true;
    }
  } catch (error) {
    console.error("[invoke] Failed to create scheduled conversation metadata:", error);
  }

  const backendUrl = `${daConfig.dynamicAgentsUrl}/api/v1/chat/invoke`;
  const response = await proxyJSONRequest(
    backendUrl,
    JSON.stringify(body),
    authResult,
    "[invoke]",
  );

  if (shouldPersistScheduledMessages) {
    try {
      await persistScheduledInvokeMessages(body, owner.email, response.clone());
    } catch (error) {
      console.error("[invoke] Failed to persist scheduled invoke messages:", error);
    }
  }

  return response;
}

export async function POST(request: NextRequest): Promise<Response> {
  // Check dynamic agents config
  const daConfig = getDynamicAgentsConfig();
  if (daConfig instanceof NextResponse) return daConfig;

  const traceContext = createAuthzTraceContext(request.headers.get("traceparent"));

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  if (!body.message || !body.conversation_id || !body.agent_id) {
    return NextResponse.json(
      { success: false, error: "Missing required fields: message, conversation_id, agent_id" },
      { status: 400 },
    );
  }

  // Scheduled cron runs are identified by the shared scheduler token, not a
  // user session. They take a dedicated path that mints a real owner bearer
  // and runs the owner gates (see handleScheduledInvoke).
  if (request.headers.get("X-Scheduler-Token")) {
    return handleScheduledInvoke(request, body, daConfig, traceContext);
  }

  // Interactive caller (session cookie or Bearer token).
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult;
  authResult.traceparent = traceContext.traceparent;

  const authzResponse = await requireAgentUsePermission({
    subject: authResult.subject,
    agentId: body.agent_id,
    email: authResult.email,
    tenantId: authResult.tenantId,
    traceparent: traceContext.traceparent,
    isServiceAccount: authResult.isServiceAccount,
  });
  if (authzResponse) return authzResponse;

  const conversationAuthzResponse = await requireConversationWriteAccess(
    authResult,
    String(body.conversation_id),
  );
  if (conversationAuthzResponse) return conversationAuthzResponse;

  // Forward body as-is to DA backend (same path, same body format)
  const backendUrl = `${daConfig.dynamicAgentsUrl}/api/v1/chat/invoke`;
  return proxyJSONRequest(
    backendUrl,
    JSON.stringify(body),
    authResult,
    "[invoke]",
  );
}
