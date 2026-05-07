// GET /api/schedules - List scheduler jobs owned by the current user

import { NextRequest } from "next/server";
import { getCollection } from "@/lib/mongodb";
import {
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

function iso(value: Date | string | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (_req, user) => {
    const schedules = await getCollection<RawSchedule>("schedules");
    const agents = await getCollection<{ _id: string; name?: string }>("dynamic_agents");

    const docs = await schedules
      .find({ owner_user_id: user.email })
      .sort({ created_at: -1 })
      .limit(200)
      .toArray();

    const agentIds = Array.from(new Set(docs.map((doc) => doc.agent_id).filter(Boolean)));
    const agentNames = new Map<string, string>();

    if (agentIds.length > 0) {
      const agentDocs = await agents
        .find({ _id: { $in: agentIds } })
        .project({ _id: 1, name: 1 })
        .toArray();

      for (const agent of agentDocs) {
        agentNames.set(agent._id, agent.name || agent._id);
      }
    }

    return successResponse({
      items: docs.map((doc) => ({
        schedule_id: doc.schedule_id,
        owner_user_id: doc.owner_user_id,
        agent_id: doc.agent_id,
        agent_name: agentNames.get(doc.agent_id) || doc.agent_id,
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
      })),
      total: docs.length,
    });
  });
});
