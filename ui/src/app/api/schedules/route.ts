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
  title?: string | null;
  message_template: string;
  pod_id?: string | null;
  attributes?: Record<string, unknown> | null;
  cron: string;
  tz: string;
  enabled?: boolean;
  cronjob_name?: string | null;
  version?: number;
  versions?: RawScheduleVersion[];
  created_at?: Date | string;
  updated_at?: Date | string;
  last_run?: {
    ts?: Date | string;
    status?: "ok" | "error";
    error?: string | null;
    http_status?: number | null;
  } | null;
}

interface RawScheduleVersion {
  version?: number;
  superseded_at?: Date | string | null;
  changed_fields?: string[];
  title?: string | null;
  agent_id?: string;
  message_template?: string;
  pod_id?: string | null;
  attributes?: Record<string, unknown> | null;
  cron?: string;
  tz?: string;
  enabled?: boolean;
  cronjob_name?: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function iso(value: Date | string | undefined | null): string | null {
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
        title: doc.title || null,
        message_template: doc.message_template,
        pod_id: doc.pod_id || null,
        attributes: doc.attributes || {},
        cron: doc.cron,
        tz: doc.tz,
        enabled: doc.enabled !== false,
        cronjob_name: doc.cronjob_name || null,
        version: doc.version || 1,
        versions: (doc.versions || [])
          .slice()
          .reverse()
          .map((version) => ({
            version: version.version || 1,
            superseded_at: iso(version.superseded_at),
            changed_fields: version.changed_fields || [],
            title: version.title || null,
            agent_id: version.agent_id || doc.agent_id,
            message_template: version.message_template || "",
            pod_id: version.pod_id || null,
            attributes: version.attributes || {},
            cron: version.cron || "",
            tz: version.tz || "",
            enabled: version.enabled !== false,
            cronjob_name: version.cronjob_name || null,
            created_at: iso(version.created_at),
            updated_at: iso(version.updated_at),
          })),
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
