import { NextRequest, NextResponse } from "next/server";

import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { scanSkillContent, isSkillScannerConfigured } from "@/lib/skill-scan";
import { recordScanEvent } from "@/lib/skill-scan-history";
import type { AgentSkill, ScanStatus } from "@/types/agent-skill";
import type { HubSkillDoc } from "@/lib/hub-crawl";

/**
 * POST /api/skills/scan-all
 *
 * Admin-only bulk scan across the catalog. Fans out the same per-skill
 * scan logic as `/api/skills/configs/[id]/scan` and `/api/skills/hub/...
 * /scan`, sequentially (scanner is fast at ~0.4s/skill statically; we
 * also want predictable LLM-cost behaviour if the LLM analyzer is on).
 *
 * Body (all optional):
 *   {
 *     scope?: "custom" | "hub" | "all"   // default: "all"
 *     hub_id?: string                    // legacy single-hub filter (kept for back-compat)
 *     hub_ids?: string[]                 // multi-select filter (preferred); empty/omitted = all hubs
 *     limit?: number                     // safety cap, default 500, max 1000
 *   }
 *
 * Response:
 *   {
 *     scope, total, scanned, skipped, duration_ms,
 *     counts: { passed, flagged, unscanned },
 *     results: [{ id, source, name, scan_status, scan_summary?, error? }, ...]
 *   }
 *
 * Why admin-only: the bulk run can be expensive (LLM analyzer cost) and
 * writes scan_status onto every visible skill, including system rows
 * other users see. Per-user "scan everything mine" is rare enough that
 * users can re-scan from the workspace; if we need it later we'll add
 * `scope: "owned"`.
 *
 * Why sequential: the standalone scanner has no per-tenant rate limits
 * and the FastAPI app uses a threadpool for /scan-upload. Running with
 * concurrency >1 risks burning LLM quota in parallel and gives no
 * meaningful UX improvement for catalogs in the low-hundreds. If a
 * deployment needs faster sweeps, raise CONCURRENCY here after wiring
 * scanner replicas in the Helm chart.
 */

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const CONCURRENCY = 1;

type Scope = "custom" | "hub" | "all";

interface BulkBody {
  scope?: Scope;
  /** Legacy single-hub filter (kept so existing callers/tests keep working). */
  hub_id?: string;
  /** Multi-select hub filter — preferred. When omitted, every hub is scanned. */
  hub_ids?: string[];
  limit?: number;
}

interface ResultRow {
  id: string;
  source: "agent_skills" | "hub";
  name: string;
  scan_status: ScanStatus;
  scan_summary?: string;
  error?: string;
  duration_ms: number;
}

/** Resolve markdown to scan, mirroring the per-skill route. */
function resolveSkillMarkdownForScan(skill: AgentSkill): string {
  const fromBuilder = skill.skill_content?.trim();
  if (fromBuilder) return fromBuilder;

  const prompts = (skill.tasks ?? [])
    .map((t) => t?.llm_prompt?.trim())
    .filter((p): p is string => Boolean(p));
  if (prompts.length === 0) return "";

  const title = skill.name?.trim() || skill.id;
  const head = `# ${title}\n\n`;
  const desc = skill.description?.trim() ? `${skill.description.trim()}\n\n` : "";
  if (prompts.length === 1) return `${head}${desc}${prompts[0]}`;
  const body = prompts.map((p, i) => `## Step ${i + 1}\n\n${p}`).join("\n\n---\n\n");
  return `${head}${desc}${body}`;
}

/**
 * Final summary emitted to the caller (also the last NDJSON line in
 * streaming mode). Mirrors the pre-streaming JSON shape so existing
 * scripts / tests reading the aggregate response keep working.
 */
interface BulkSummary {
  scope: Scope;
  total: number;
  scanned: number;
  skipped: number;
  duration_ms: number;
  counts: Record<ScanStatus, number>;
  results: ResultRow[];
}

/**
 * Per-row event for NDJSON streaming. The client uses these to drive
 * the live progress bar + per-skill list in `<ScanAllDialog>`.
 *
 * Order on the wire:
 *   1. `start` — once, with `total_planned` (best-effort upper bound from
 *      countDocuments + the limit cap) so the UI can render a real %.
 *   2. `row`   — one per skill, in scan order. The same shape that
 *      eventually lands in `results[]`.
 *   3. `complete` — once at the end with the same summary the JSON path
 *      returns. Stream is closed immediately after.
 */
type StreamEvent =
  | { type: "start"; scope: Scope; total_planned: number }
  | { type: "row"; row: ResultRow; index: number }
  | { type: "complete"; summary: BulkSummary };

/**
 * Core sweep. Decoupled from the response shape so the same logic
 * powers both `application/json` (aggregate) and
 * `application/x-ndjson` (live progress) paths.
 *
 * `onRow` is awaited so back-pressure on the SSE/NDJSON writer doesn't
 * outpace the scanner; in practice each scan is ~0.4-1s, far slower
 * than a stream write.
 */
async function runBulkScan(
  scope: Scope,
  body: BulkBody,
  limit: number,
  actor: string,
  onRow?: (row: ResultRow, index: number) => void | Promise<void>,
): Promise<BulkSummary> {
  const tStart = Date.now();
  const results: ResultRow[] = [];
  const counts: Record<ScanStatus, number> = { passed: 0, flagged: 0, unscanned: 0 };
  let scanned = 0;
  let skipped = 0;

  // Local helper so both branches push, count, and notify in lockstep —
  // avoids any chance of `results` and the streamed events drifting.
  const emit = async (row: ResultRow): Promise<void> => {
    results.push(row);
    await onRow?.(row, results.length - 1);
  };

  // -----------------------------------------------------------------
  // Custom (user-authored) skills
  // -----------------------------------------------------------------
  if (scope === "custom" || scope === "all") {
    const col = await getCollection<AgentSkill>("agent_skills");
    const cursor = col
      .find({})
      .project<AgentSkill>({ _id: 0 })
      .limit(limit);

    for await (const skill of cursor) {
      const content = resolveSkillMarkdownForScan(skill);
      if (!content) {
        skipped += 1;
        await emit({
          id: skill.id,
          source: "agent_skills",
          name: skill.name,
          scan_status: "unscanned",
          error: "No SKILL.md or task prompts to scan",
          duration_ms: 0,
        });
        continue;
      }

      const t0 = Date.now();
      let scanResult: Awaited<ReturnType<typeof scanSkillContent>>;
      let error: string | undefined;
      try {
        scanResult = await scanSkillContent(skill.name, content, skill.id, {
          ancillaryFiles: skill.ancillary_files,
        });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        scanResult = { scan_status: "unscanned", unscanned_reason: error };
      }
      const dur = Date.now() - t0;

      // Surface the scanner's "why unscanned" reason to the dialog
      // row + persist it as scan_summary so admins can see at a
      // glance whether it was empty content, an HTTP error, a
      // timeout, etc. — without digging into Next.js logs.
      const rowError = error ?? scanResult.unscanned_reason;
      const persistedSummary =
        scanResult.scan_summary ?? scanResult.unscanned_reason;

      // Persist onto the skill so the gallery shield reflects the
      // new state without a manual save.
      const now = new Date();
      try {
        await col.updateOne(
          { id: skill.id },
          {
            $set: {
              scan_status: scanResult.scan_status,
              ...(persistedSummary !== undefined
                ? { scan_summary: persistedSummary }
                : {}),
              scan_updated_at: now,
              updated_at: now,
            },
          },
        );
      } catch (err) {
        console.warn(
          `[scan-all] Failed to persist scan for agent_skills/${skill.id}:`,
          err,
        );
      }

      await recordScanEvent({
        trigger: "bulk_user_skill",
        skill_id: skill.id,
        skill_name: skill.name,
        source: skill.is_system ? "default" : "agent_skills",
        actor,
        scan_status: scanResult.scan_status,
        scan_summary: persistedSummary,
        scanner_unavailable: scanResult.scan_status === "unscanned",
        duration_ms: dur,
      });

      scanned += 1;
      counts[scanResult.scan_status] += 1;
      await emit({
        id: skill.id,
        source: "agent_skills",
        name: skill.name,
        scan_status: scanResult.scan_status,
        scan_summary: scanResult.scan_summary,
        error: rowError,
        duration_ms: dur,
      });

      if (results.length >= limit) break;
    }
  }

  // -----------------------------------------------------------------
  // Hub-cached skills
  // -----------------------------------------------------------------
  if ((scope === "hub" || scope === "all") && results.length < limit) {
    const remaining = limit - results.length;
    const col = await getCollection<HubSkillDoc>("hub_skills");
    // Hub filter precedence: hub_ids[] (multi-select) wins; fall back to
    // legacy single hub_id; otherwise scan every hub.
    const hubIds = Array.isArray(body.hub_ids)
      ? body.hub_ids.filter((s): s is string => typeof s === "string" && s.length > 0)
      : [];
    const filter: Record<string, unknown> = {};
    if (hubIds.length > 0) {
      filter.hub_id = hubIds.length === 1 ? hubIds[0] : { $in: hubIds };
    } else if (body.hub_id) {
      filter.hub_id = body.hub_id;
    }

    const cursor = col
      .find(filter)
      .project<HubSkillDoc>({ _id: 0 })
      .limit(remaining);

    for await (const doc of cursor) {
      const content = doc.content?.trim();
      if (!content) {
        skipped += 1;
        await emit({
          id: `hub-${doc.hub_id}-${doc.skill_id}`,
          source: "hub",
          name: doc.name,
          scan_status: "unscanned",
          error: "No SKILL.md cached for hub skill",
          duration_ms: 0,
        });
        continue;
      }

      const t0 = Date.now();
      let scanResult: Awaited<ReturnType<typeof scanSkillContent>>;
      let error: string | undefined;
      try {
        scanResult = await scanSkillContent(
          doc.name,
          content,
          `hub-${doc.hub_id}-${doc.skill_id}`,
          { ancillaryFiles: doc.ancillary_files },
        );
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        scanResult = { scan_status: "unscanned", unscanned_reason: error };
      }
      const dur = Date.now() - t0;

      const rowError = error ?? scanResult.unscanned_reason;
      const persistedSummary =
        scanResult.scan_summary ?? scanResult.unscanned_reason;

      const now = new Date();
      try {
        await col.updateOne(
          { hub_id: doc.hub_id, skill_id: doc.skill_id },
          {
            $set: {
              scan_status: scanResult.scan_status,
              ...(persistedSummary !== undefined
                ? { scan_summary: persistedSummary }
                : {}),
              scan_updated_at: now,
            },
          },
        );
      } catch (err) {
        console.warn(
          `[scan-all] Failed to persist scan for hub_skills/${doc.hub_id}/${doc.skill_id}:`,
          err,
        );
      }

      await recordScanEvent({
        trigger: "bulk_hub_skill",
        skill_id: `hub-${doc.hub_id}-${doc.skill_id}`,
        skill_name: doc.name,
        source: "hub",
        hub_id: doc.hub_id,
        actor,
        scan_status: scanResult.scan_status,
        scan_summary: persistedSummary,
        scanner_unavailable: scanResult.scan_status === "unscanned",
        duration_ms: dur,
      });

      scanned += 1;
      counts[scanResult.scan_status] += 1;
      await emit({
        id: `hub-${doc.hub_id}-${doc.skill_id}`,
        source: "hub",
        name: doc.name,
        scan_status: scanResult.scan_status,
        scan_summary: scanResult.scan_summary,
        error: rowError,
        duration_ms: dur,
      });
    }
  }

  return {
    scope,
    total: results.length,
    scanned,
    skipped,
    counts,
    duration_ms: Date.now() - tStart,
    results,
  };
}

/**
 * Best-effort upper bound on how many skills the sweep will touch. Used
 * for the streaming `start` event so the UI can show a real percentage
 * instead of a spinner. We `countDocuments()` against the same filters
 * each branch will use, then cap by `limit`. Off-by-one drift (skill
 * deleted between count and scan) is fine — the bar caps at 100%.
 */
async function planTotal(
  scope: Scope,
  body: BulkBody,
  limit: number,
): Promise<number> {
  let total = 0;
  if (scope === "custom" || scope === "all") {
    const col = await getCollection<AgentSkill>("agent_skills");
    total += await col.countDocuments({});
    if (total >= limit) return limit;
  }
  if (scope === "hub" || scope === "all") {
    const col = await getCollection<HubSkillDoc>("hub_skills");
    const hubIds = Array.isArray(body.hub_ids)
      ? body.hub_ids.filter((s): s is string => typeof s === "string" && s.length > 0)
      : [];
    const filter: Record<string, unknown> = {};
    if (hubIds.length > 0) {
      filter.hub_id = hubIds.length === 1 ? hubIds[0] : { $in: hubIds };
    } else if (body.hub_id) {
      filter.hub_id = body.hub_id;
    }
    total += await col.countDocuments(filter);
  }
  return Math.min(limit, total);
}

/**
 * Stream the sweep as NDJSON so `<ScanAllDialog>` can render a live
 * progress bar + per-skill list. Each line is a single JSON event;
 * the client splits on '\n' and parses individually. We deliberately
 * do not use SSE (`text/event-stream`) here — NDJSON is simpler to
 * generate from a `ReadableStream`, doesn't need the `data:` prefix
 * dance, and is just as well-supported by `fetch().body.getReader()`.
 */
function streamBulkScan(
  scope: Scope,
  body: BulkBody,
  limit: number,
  actor: string,
): NextResponse {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeEvent = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const totalPlanned = await planTotal(scope, body, limit);
        writeEvent({ type: "start", scope, total_planned: totalPlanned });

        const summary = await runBulkScan(
          scope,
          body,
          limit,
          actor,
          (row, index) => {
            writeEvent({ type: "row", row, index });
          },
        );

        writeEvent({ type: "complete", summary });
        controller.close();
      } catch (err) {
        // Surface the failure as a final NDJSON line so the UI can
        // distinguish a stream error from a transport drop.
        const reason = err instanceof Error ? err.message : String(err);
        writeEvent({
          type: "complete",
          summary: {
            scope,
            total: 0,
            scanned: 0,
            skipped: 0,
            counts: { passed: 0, flagged: 0, unscanned: 0 },
            duration_ms: 0,
            results: [],
          },
        });
        controller.error(new Error(reason));
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Disable proxy buffering so the user sees rows as they land.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("Skills requires MongoDB to be configured", 503);
  }
  if (!isSkillScannerConfigured()) {
    throw new ApiError(
      "Scanner is not configured. Set SKILL_SCANNER_URL (e.g. http://skill-scanner:8000) so the UI can reach the standalone skill-scanner service.",
      503,
    );
  }

  return await withAuth(request, async (req, user) => {
    if (user.role !== "admin") {
      throw new ApiError("Bulk scan is restricted to admins.", 403);
    }

    const body = (await req.json().catch(() => ({}))) as BulkBody;
    const scope: Scope = body.scope ?? "all";
    if (!["custom", "hub", "all"].includes(scope)) {
      throw new ApiError(`Invalid scope: ${scope}`, 400);
    }
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, body.limit ?? DEFAULT_LIMIT),
    );

    // Content negotiation: admins opting into live progress send
    // `Accept: application/x-ndjson` (the dialog does this). Anyone else
    // — scripts, tests, the legacy fetch path — gets the aggregate JSON
    // response unchanged.
    const accept = req.headers.get("accept") ?? "";
    if (accept.includes("application/x-ndjson")) {
      return streamBulkScan(scope, body, limit, user.email);
    }

    const summary = await runBulkScan(scope, body, limit, user.email);
    return successResponse(summary);
  });
});

// CONCURRENCY is exported for tests / future tuning. Currently 1 (sequential).
export const __CONCURRENCY = CONCURRENCY;
