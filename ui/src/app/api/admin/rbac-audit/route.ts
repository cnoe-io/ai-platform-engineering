import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { requireRbacPermission, withErrorHandler, ApiError } from "@/lib/api-middleware";
import type { AuditEvent, AuditOutcome, RbacResource } from "@/lib/rbac/types";

const COLLECTION = "authorization_decision_records";

/** MongoDB row shape (`ts` as Date per data-model / audit persistence). */
type AuthorizationDecisionDocument = Omit<AuditEvent, "ts"> & { ts: Date };

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

function documentToAuditEvent(doc: AuthorizationDecisionDocument): AuditEvent {
  const ts =
    doc.ts instanceof Date
      ? doc.ts.toISOString()
      : new Date(doc.ts as unknown as string).toISOString();

  return {
    ts,
    tenant_id: doc.tenant_id,
    subject_hash: doc.subject_hash,
    actor_hash: doc.actor_hash,
    capability: doc.capability,
    component: doc.component,
    resource_ref: doc.resource_ref,
    outcome: doc.outcome,
    reason_code: doc.reason_code,
    pdp: doc.pdp,
    correlation_id: doc.correlation_id,
  };
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: "MongoDB not configured",
        code: "MONGODB_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    throw new ApiError("Unauthorized", 401);
  }

  await requireRbacPermission(
    { accessToken: session.accessToken, sub: session.sub, org: session.org },
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

  const filter: Record<string, unknown> = {
    ts: { $gte: from, $lte: to },
  };

  if (session.org) {
    filter.tenant_id = session.org;
  }

  if (component) {
    filter.component = component as RbacResource;
  }
  if (capability) {
    filter.capability = capability;
  }
  if (subjectHash) {
    filter.subject_hash = subjectHash;
  }
  if (outcome) {
    filter.outcome = outcome;
  }

  const coll = await getCollection<AuthorizationDecisionDocument>(COLLECTION);

  const [total, docs] = await Promise.all([
    coll.countDocuments(filter),
    coll
      .find(filter)
      .sort({ ts: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
  ]);

  const records: AuditEvent[] = docs.map(documentToAuditEvent);

  return NextResponse.json({
    records,
    total,
    page,
    limit,
  });
});
