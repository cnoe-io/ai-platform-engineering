import { ApiError, requireRbacPermission, withErrorHandler } from "@/lib/api-middleware";
import { authOptions } from "@/lib/auth-config";
import { summarizeMigrationComparisons } from "@/lib/authz/comparison-summary";
import type { UnifiedAuditEvent } from "@/lib/rbac/types";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

const VALID_WINDOWS = new Set(["5m", "15m", "30m", "1h", "6h", "12h", "24h", "7d"]);
const VALID_AUTHORITATIVE_PATHS = new Set(["LEGACY", "AUTHZ"]);
const VALID_MISMATCH_CLASSES = new Set([
  "NONE",
  "ALLOW_DENY",
  "DENY_ALLOW",
  "ERROR_RESULT",
  "REASON_ONLY",
  "LATENCY",
]);
const SUMMARY_LIMIT = 10_000;

function auditServiceBaseUrl(): string {
  return (process.env.AUDIT_SERVICE_URL ?? process.env.AUDIT_LOG_SERVICE_URL ?? "http://audit-service:8010")
    .replace(/\/$/, "");
}

export const GET = withErrorHandler(async (request: NextRequest): Promise<NextResponse> => {
  const session = (await getServerSession(authOptions)) as {
    accessToken?: string;
    sub?: string;
    org?: string;
    user?: { email?: string | null };
  } | null;
  if (!session?.user?.email) throw new ApiError("Unauthorized", 401);

  await requireRbacPermission(
    {
      accessToken: session.accessToken,
      sub: session.sub,
      org: session.org,
      user: { email: session.user.email },
    },
    "admin_ui",
    "audit.view",
  );

  const incoming = request.nextUrl.searchParams;
  const requestedWindow = incoming.get("window")?.trim().toLowerCase() || "1h";
  const from = incoming.get("from")?.trim();
  const to = incoming.get("to")?.trim();
  const authoritativePath = incoming.get("authoritative_path")?.trim().toUpperCase();
  const mismatchClass = incoming.get("mismatch_class")?.trim().toUpperCase();
  if (requestedWindow !== "custom" && !VALID_WINDOWS.has(requestedWindow)) {
    throw new ApiError("Invalid comparison window", 400);
  }
  if (requestedWindow === "custom" && (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)))) {
    throw new ApiError("Custom comparison window requires valid from and to values", 400);
  }
  if (authoritativePath && !VALID_AUTHORITATIVE_PATHS.has(authoritativePath)) {
    throw new ApiError("Invalid authoritative path", 400);
  }
  if (mismatchClass && !VALID_MISMATCH_CLASSES.has(mismatchClass)) {
    throw new ApiError("Invalid mismatch class", 400);
  }

  const params = new URLSearchParams({
    type: "authz_migration_comparison",
    limit: String(SUMMARY_LIMIT),
  });
  if (requestedWindow === "custom") {
    params.set("since", new Date(from!).toISOString());
    params.set("until", new Date(to!).toISOString());
  } else {
    params.set("window", requestedWindow);
  }
  if (session.org) params.set("tenant_id", session.org);
  const rolloutRevision = incoming.get("rollout_revision")?.trim();
  if (rolloutRevision) params.set("rollout_revision", rolloutRevision);
  if (authoritativePath) params.set("authoritative_path", authoritativePath);
  if (mismatchClass) params.set("mismatch_class", mismatchClass);

  let response: Response;
  try {
    response = await fetch(`${auditServiceBaseUrl()}/v1/audit/events?${params.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(Number(process.env.AUDIT_COMPARISON_TIMEOUT_MS ?? 5_000)),
    });
  } catch (error) {
    throw new ApiError(
      `Audit comparison service unavailable: ${error instanceof Error ? error.message : String(error)}`,
      503,
    );
  }
  if (!response.ok) throw new ApiError(`Audit comparison service returned ${response.status}`, 503);

  const body = (await response.json()) as {
    records?: UnifiedAuditEvent[];
    total?: number;
    truncated?: boolean;
  };
  const records = body.records ?? [];
  return NextResponse.json(
    summarizeMigrationComparisons(records, {
      total: body.total,
      truncated: body.truncated === true || (body.total ?? records.length) > records.length,
    }),
  );
});
