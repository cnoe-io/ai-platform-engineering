import { ApiError, requireRbacPermission, withErrorHandler } from "@/lib/api-middleware";
import { authOptions } from "@/lib/auth-config";
import { getAuditReader } from "@/lib/audit/reader";
import type { AuditEvent, AuditOutcome, AuditPdp, AuditReasonCode, RbacResource } from "@/lib/rbac/types";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

// assisted-by Codex Codex-sonnet-4-6

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

function recordToAuditEvent(record: Record<string, unknown>): AuditEvent {
  const rawTs = record.ts;
  const ts = rawTs instanceof Date ? rawTs.toISOString() : new Date(String(rawTs)).toISOString();

  return {
    ts,
    tenant_id: String(record.tenant_id ?? ""),
    subject_hash: String(record.subject_hash ?? ""),
    actor_hash: typeof record.actor_hash === "string" ? record.actor_hash : undefined,
    capability: String(record.capability ?? record.action ?? ""),
    component: String(record.component ?? "admin_ui") as RbacResource,
    resource_ref: typeof record.resource_ref === "string" ? record.resource_ref : undefined,
    outcome: String(record.outcome ?? "deny") as AuditOutcome,
    reason_code: String(record.reason_code ?? "DENY_NO_CAPABILITY") as AuditReasonCode,
    pdp: String(record.pdp ?? "openfga") as AuditPdp,
    correlation_id: String(record.correlation_id ?? ""),
  };
}

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
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

  const component = url.searchParams.get("component")?.trim();
  const capability = url.searchParams.get("capability")?.trim();
  const subjectHash = url.searchParams.get("subject_hash")?.trim();
  const outcomeParam = url.searchParams.get("outcome")?.trim().toLowerCase();

  let outcome: AuditOutcome | undefined;
  if (outcomeParam) {
    if (outcomeParam !== "allow" && outcomeParam !== "deny") {
      throw new ApiError('`outcome` must be "allow" or "deny"', 400, "VALIDATION_ERROR");
    }
    outcome = outcomeParam as AuditOutcome;
  }

  const pageRaw = url.searchParams.get("page") ?? "1";
  const limitRaw = url.searchParams.get("limit") ?? "50";
  const page = parseInt(pageRaw, 10);
  const limit = parseInt(limitRaw, 10);

  if (!Number.isFinite(page) || page < 1) {
    throw new ApiError("`page` must be a number >= 1", 400, "VALIDATION_ERROR");
  }
  if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
    throw new ApiError("`limit` must be a number between 1 and 200", 400, "VALIDATION_ERROR");
  }

  const rows = await getAuditReader().query({
    since: from,
    until: to,
    tenantId: session.org,
    component,
    capability,
    subjectHash,
    outcome,
    limit: page * limit,
  });

  const offset = (page - 1) * limit;
  const records: AuditEvent[] = rows.slice(offset, offset + limit).map(recordToAuditEvent);

  return NextResponse.json({
    records,
    total: rows.length,
    page,
    limit,
  });
});
