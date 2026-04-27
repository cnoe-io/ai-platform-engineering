import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { requireRbacPermission, withErrorHandler, ApiError } from "@/lib/api-middleware";
import type {
  AuditEventType,
  UnifiedAuditEvent,
  UnifiedAuditOutcome,
} from "@/lib/rbac/types";

const COLLECTION = "audit_events";

const VALID_TYPES: AuditEventType[] = ["auth", "tool_action", "agent_delegation"];
const VALID_OUTCOMES: UnifiedAuditOutcome[] = ["allow", "deny", "success", "error"];

interface AuditEventDocument {
  ts: Date;
  type: AuditEventType;
  tenant_id: string;
  subject_hash: string;
  user_email?: string;
  action: string;
  agent_name?: string;
  tool_name?: string;
  outcome: UnifiedAuditOutcome;
  reason_code?: string;
  duration_ms?: number;
  correlation_id: string;
  context_id?: string;
  component?: string;
  resource_ref?: string;
  pdp?: string;
  source: string;
}

function parseIsoDate(value: string | null, label: string): Date {
  if (!value?.trim()) {
    throw new ApiError(`Invalid ${label}: expected ISO date string`, 400, "VALIDATION_ERROR");
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ApiError(`Invalid ${label}: not a valid ISO date`, 400, "VALIDATION_ERROR");
  }
  return d;
}

function documentToEvent(doc: AuditEventDocument): UnifiedAuditEvent {
  const ts =
    doc.ts instanceof Date
      ? doc.ts.toISOString()
      : new Date(doc.ts as unknown as string).toISOString();

  return {
    ts,
    type: doc.type,
    tenant_id: doc.tenant_id,
    subject_hash: doc.subject_hash,
    user_email: doc.user_email,
    action: doc.action,
    agent_name: doc.agent_name,
    tool_name: doc.tool_name,
    outcome: doc.outcome,
    reason_code: doc.reason_code,
    duration_ms: doc.duration_ms,
    correlation_id: doc.correlation_id,
    context_id: doc.context_id,
    component: doc.component,
    resource_ref: doc.resource_ref,
    pdp: doc.pdp,
    source: doc.source as UnifiedAuditEvent["source"],
  };
}

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: "MongoDB not configured", code: "MONGODB_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const session = (await getServerSession(authOptions)) as {
    accessToken?: string;
    sub?: string;
    org?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email) {
    throw new ApiError("Unauthorized", 401);
  }

  await requireRbacPermission(
    {
      accessToken: session.accessToken,
      sub: session.sub,
      org: session.org,
      user: { email: session.user.email ?? undefined },
    },
    "admin_ui",
    "audit.view",
  );

  const url = new URL(request.url);
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam ? parseIsoDate(fromParam, "from") : defaultFrom;
  const to = toParam ? parseIsoDate(toParam, "to") : now;

  if (from.getTime() > to.getTime()) {
    throw new ApiError("`from` must be before or equal to `to`", 400, "VALIDATION_ERROR");
  }

  const typeParam = url.searchParams.get("type")?.trim().toLowerCase();
  const agentName = url.searchParams.get("agent_name")?.trim();
  const toolName = url.searchParams.get("tool_name")?.trim();
  const outcomeParam = url.searchParams.get("outcome")?.trim().toLowerCase();
  const userEmail = url.searchParams.get("user_email")?.trim();
  const component = url.searchParams.get("component")?.trim();
  const correlationId = url.searchParams.get("correlation_id")?.trim();

  if (typeParam && !VALID_TYPES.includes(typeParam as AuditEventType)) {
    throw new ApiError(
      `\`type\` must be one of: ${VALID_TYPES.join(", ")}`,
      400,
      "VALIDATION_ERROR",
    );
  }

  if (outcomeParam && !VALID_OUTCOMES.includes(outcomeParam as UnifiedAuditOutcome)) {
    throw new ApiError(
      `\`outcome\` must be one of: ${VALID_OUTCOMES.join(", ")}`,
      400,
      "VALIDATION_ERROR",
    );
  }

  const pageRaw = url.searchParams.get("page") ?? "1";
  const limitRaw = url.searchParams.get("limit") ?? "50";
  const page = parseInt(pageRaw, 10);
  const limit = parseInt(limitRaw, 10);

  if (!Number.isFinite(page) || page < 1) {
    throw new ApiError("`page` must be a number >= 1", 400, "VALIDATION_ERROR");
  }
  if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
    throw new ApiError("`limit` must be between 1 and 200", 400, "VALIDATION_ERROR");
  }

  const filter: Record<string, unknown> = {
    ts: { $gte: from, $lte: to },
  };

  if (session.org) {
    filter.tenant_id = session.org;
  }
  if (typeParam) {
    filter.type = typeParam;
  }
  if (agentName) {
    filter.agent_name = agentName;
  }
  if (toolName) {
    filter.tool_name = toolName;
  }
  if (outcomeParam) {
    filter.outcome = outcomeParam;
  }
  if (userEmail) {
    filter.user_email = { $regex: userEmail, $options: "i" };
  }
  if (component) {
    filter.component = component;
  }
  if (correlationId) {
    filter.correlation_id = correlationId;
  }

  const coll = await getCollection<AuditEventDocument>(COLLECTION);

  const [total, docs] = await Promise.all([
    coll.countDocuments(filter),
    coll
      .find(filter)
      .sort({ ts: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
  ]);

  const records: UnifiedAuditEvent[] = docs.map(documentToEvent);

  return NextResponse.json({ records, total, page, limit });
});
