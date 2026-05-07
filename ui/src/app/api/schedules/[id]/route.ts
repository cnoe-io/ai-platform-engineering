// PATCH /api/schedules/[id] - Pause or restart a scheduler job owned by the current user.

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
  ApiError,
  successResponse,
  withAuth,
  withErrorHandler,
} from "@/lib/api-middleware";

export const dynamic = "force-dynamic";

interface RawSchedule {
  schedule_id: string;
  owner_user_id: string;
  agent_id: string;
  message_template: string;
  pod_id?: string | null;
  cron: string;
  tz: string;
  enabled?: boolean;
  cronjob_name?: string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
  last_run?: {
    ts?: Date | string;
    status?: "ok" | "error";
    error?: string | null;
    http_status?: number | null;
  } | null;
}

interface SchedulerPatchBody {
  enabled?: unknown;
  action?: unknown;
}

function iso(value: Date | string | undefined | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

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

function enabledFromBody(body: SchedulerPatchBody): boolean {
  if (typeof body.enabled === "boolean") return body.enabled;

  if (body.action === "pause") return false;
  if (body.action === "resume" || body.action === "restart") return true;

  throw new ApiError(
    "Request body must include enabled, or action pause/resume/restart",
    400
  );
}

function schedulerErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const errorBody = body as { detail?: unknown; error?: unknown };
    if (errorBody.detail) return String(errorBody.detail);
    if (errorBody.error) return String(errorBody.error);
  }
  return `Scheduler service returned ${status}`;
}

function mapSchedule(doc: RawSchedule, agentName: string) {
  return {
    schedule_id: doc.schedule_id,
    owner_user_id: doc.owner_user_id,
    agent_id: doc.agent_id,
    agent_name: agentName || doc.agent_id,
    message_template: doc.message_template,
    pod_id: doc.pod_id || null,
    cron: doc.cron,
    tz: doc.tz,
    enabled: doc.enabled !== false,
    cronjob_name: doc.cronjob_name || null,
    created_at: iso(doc.created_at),
    updated_at: iso(doc.updated_at),
    last_run: doc.last_run
      ? {
          ts: iso(doc.last_run.ts),
          status: doc.last_run.status || null,
          error: doc.last_run.error || null,
          http_status: doc.last_run.http_status || null,
        }
      : null,
  };
}

async function patchScheduler(scheduleId: string, enabled: boolean): Promise<RawSchedule> {
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
      `${schedulerBaseUrl()}/v1/schedules/${encodeURIComponent(scheduleId)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ enabled }),
        cache: "no-store",
      }
    );
  } catch (error) {
    throw new ApiError(
      error instanceof Error
        ? `Scheduler service is unavailable: ${error.message}`
        : "Scheduler service is unavailable",
      502
    );
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message = schedulerErrorMessage(body, response.status);
    throw new ApiError(String(message), response.status < 500 ? response.status : 502);
  }

  return body as RawSchedule;
}

export const PATCH = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { id: scheduleId } = await context.params;
    if (!scheduleId) {
      throw new ApiError("Schedule ID is required", 400);
    }

    return withAuth(request, async (_req, user) => {
      const schedules = await getCollection<RawSchedule>("schedules");
      const existing = await schedules.findOne({
        schedule_id: scheduleId,
        owner_user_id: user.email,
      });

      if (!existing) {
        throw new ApiError("Schedule not found", 404);
      }

      const body = (await request.json().catch(() => ({}))) as SchedulerPatchBody;
      const enabled = enabledFromBody(body);
      const updated = await patchScheduler(scheduleId, enabled);

      const agents = await getCollection<{ _id: string; name?: string }>("dynamic_agents");
      const agent = await agents.findOne(
        { _id: updated.agent_id || existing.agent_id },
        { projection: { _id: 1, name: 1 } }
      );

      return successResponse(mapSchedule(updated, agent?.name || existing.agent_id));
    });
  }
);
