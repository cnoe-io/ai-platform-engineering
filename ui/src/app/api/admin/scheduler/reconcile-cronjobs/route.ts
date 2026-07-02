// POST /api/admin/scheduler/reconcile-cronjobs - Dry-run/apply CronJob runner image reconciliation.

import { NextRequest, NextResponse } from "next/server";
import {
  ApiError,
  getAuthFromBearerOrSession,
  requireAdmin,
  withErrorHandler,
} from "@/lib/api-middleware";

export const dynamic = "force-dynamic";

function schedulerBaseUrl(): string {
  return (
    process.env.SCHEDULER_URL ||
    process.env.CAIPE_SCHEDULER_URL ||
    "http://caipe-scheduler:8080"
  ).replace(/\/+$/, "");
}

function schedulerToken(): string {
  return (
    process.env.SCHEDULER_SERVICE_TOKEN ||
    process.env.CAIPE_SCHEDULER_SERVICE_TOKEN ||
    ""
  );
}

function schedulerErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  if (typeof body === "string" && body.trim()) return body;
  return `Scheduler reconcile failed with HTTP ${status}`;
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  requireAdmin(session);

  const body = await request.json().catch(() => ({}));
  const dryRun = body?.dry_run !== false;
  const scheduleId = typeof body?.schedule_id === "string" && body.schedule_id.trim()
    ? body.schedule_id.trim()
    : undefined;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = schedulerToken();
  if (token) {
    headers["X-Scheduler-Token"] = token;
  }

  let response: Response;
  try {
    response = await fetch(
      `${schedulerBaseUrl()}/v1/admin/reconcile-cronjobs`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          dry_run: dryRun,
          ...(scheduleId ? { schedule_id: scheduleId } : {}),
        }),
        cache: "no-store",
      },
    );
  } catch (error) {
    throw new ApiError(
      error instanceof Error
        ? `Scheduler service is unavailable: ${error.message}`
        : "Scheduler service is unavailable",
      502,
    );
  }

  const text = await response.text();
  let result: unknown = null;
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      result = text;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      schedulerErrorMessage(result, response.status),
      response.status < 500 ? response.status : 502,
    );
  }

  return NextResponse.json(result);
});
