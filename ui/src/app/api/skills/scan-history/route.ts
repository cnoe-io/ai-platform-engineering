import { NextRequest } from "next/server";
import {
  withAuth,
  withErrorHandler,
  successResponse,
} from "@/lib/api-middleware";
import {
  listScanHistory,
  type ScanHistoryQuery,
} from "@/lib/skill-scan-history";
import type { ScanStatus } from "@/types/agent-skill";

const VALID_STATUS: ScanStatus[] = ["passed", "flagged", "unscanned"];
const VALID_TRIGGER = [
  "manual_user_skill",
  "manual_hub_skill",
  "auto_save",
  "hub_crawl",
] as const;
const VALID_SOURCE = ["agent_skills", "hub", "default"] as const;

/**
 * GET /api/skills/scan-history
 *
 * Returns paginated, filterable scan audit log for any signed-in user.
 * Read-only — events are written by scan endpoints, never via this route.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async () => {
    const { searchParams } = new URL(request.url);
    const query: ScanHistoryQuery = {
      page: parsePositiveInt(searchParams.get("page")),
      pageSize: parsePositiveInt(searchParams.get("page_size")),
      q: searchParams.get("q") ?? undefined,
    };

    const status = searchParams.get("status");
    if (status && (VALID_STATUS as string[]).includes(status)) {
      query.status = status as ScanStatus;
    }
    const trigger = searchParams.get("trigger");
    if (trigger && (VALID_TRIGGER as readonly string[]).includes(trigger)) {
      query.trigger = trigger as ScanHistoryQuery["trigger"];
    }
    const source = searchParams.get("source");
    if (source && (VALID_SOURCE as readonly string[]).includes(source)) {
      query.source = source as ScanHistoryQuery["source"];
    }
    const skillId = searchParams.get("skill_id");
    if (skillId) {
      query.skill_id = skillId;
    }

    const result = await listScanHistory(query);
    return successResponse(result);
  });
});

function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
