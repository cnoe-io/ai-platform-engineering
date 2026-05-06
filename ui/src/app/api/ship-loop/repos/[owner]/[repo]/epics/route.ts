/**
 * GET /api/ship-loop/repos/{owner}/{repo}/epics
 *
 * List Epics for an onboarded repo, with `child_counts` per Epic and
 * cursor-based pagination keyed on `(last_event_at desc, _id desc)`.
 *
 * Filters (all optional):
 *   - stage=specify|plan|...|observe|blocked
 *   - needs_human=true        -> only Epics with HITL items
 *   - stalled=true            -> only Epics flagged stalled
 *   - limit=1..100 (default 50)
 *   - cursor=<base64 of {t,id}>  -> from prior response's next_cursor
 *
 * The response shape matches contracts/http-api.md exactly so the
 * UI hooks can deserialise without a wrapping layer.
 */

import { ObjectId } from "mongodb";
import {
  getShipLoopArtifactsCollection,
  getShipLoopReposCollection,
} from "@/lib/ship-loop/mongo-collections";
import { withShipLoopGate } from "@/lib/ship-loop/guard";
import { requireShipLoopReader } from "@/lib/ship-loop/ship-loop-auth";
import type { ShipLoopArtifact, ShipLoopStage } from "@/types/ship-loop";
import { SHIP_LOOP_STAGES } from "@/types/ship-loop";

interface EpicListItem {
  artifact_id: string;
  title: string;
  current_stage: ShipLoopStage;
  needs_human: boolean;
  stalled_since: string | null;
  child_counts: { subtasks: number; prs: number; deploys: number };
  github_url: string;
  last_event_at: string;
}

interface EpicListResponse {
  items: EpicListItem[];
  next_cursor: string | null;
}

interface CursorPayload {
  t: string; // ISO last_event_at
  id: string; // hex _id
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseCursor(raw: string | null): CursorPayload | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const obj = JSON.parse(decoded) as Partial<CursorPayload>;
    if (!obj || typeof obj.t !== "string" || typeof obj.id !== "string") {
      return null;
    }
    if (Number.isNaN(Date.parse(obj.t))) return null;
    if (!ObjectId.isValid(obj.id)) return null;
    return { t: obj.t, id: obj.id };
  } catch {
    return null;
  }
}

function makeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

async function handle(
  req: Request,
  ctx: { params: Promise<{ owner: string; repo: string }> },
): Promise<Response> {
  const reader = await requireShipLoopReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }

  const { owner, repo } = await ctx.params;
  const repos = await getShipLoopReposCollection();
  const repoDoc = await repos.findOne(
    { owner, name: repo, offboarded_at: null },
    { projection: { repo_id: 1 } },
  );
  if (!repoDoc) {
    return Response.json(
      { error: "not_found", message: "Repo not onboarded." },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const stageParam = url.searchParams.get("stage");
  const needsHuman = url.searchParams.get("needs_human") === "true";
  const stalled = url.searchParams.get("stalled") === "true";
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT),
  );
  const cursor = parseCursor(url.searchParams.get("cursor"));

  // Validate stage filter against the closed enum so a typo doesn't
  // silently return an empty list.
  let stage: ShipLoopStage | null = null;
  if (stageParam) {
    if ((SHIP_LOOP_STAGES as string[]).includes(stageParam)) {
      stage = stageParam as ShipLoopStage;
    } else {
      return Response.json(
        { error: "bad_stage", message: `Unknown stage "${stageParam}".` },
        { status: 400 },
      );
    }
  }

  const filter: Record<string, unknown> = {
    repo_id: repoDoc.repo_id,
    kind: "epic",
  };
  if (stage) filter.current_stage = stage;
  if (needsHuman) filter.needs_human = true;
  if (stalled) filter.stalled_since = { $ne: null };

  if (cursor) {
    const t = new Date(cursor.t);
    const id = new ObjectId(cursor.id);
    // Strict-less cursor: rows whose (last_event_at, _id) tuple comes
    // strictly *after* the cursor in our descending sort order.
    filter.$or = [
      { last_event_at: { $lt: t } },
      { last_event_at: t, _id: { $lt: id } },
    ];
  }

  const artifacts = await getShipLoopArtifactsCollection();
  const epicDocs = await artifacts
    .find(filter, { sort: { last_event_at: -1, _id: -1 }, limit: limit + 1 })
    .toArray();

  const hasMore = epicDocs.length > limit;
  const pageDocs = hasMore ? epicDocs.slice(0, limit) : epicDocs;

  const childCounts = await loadChildCountsForEpics(
    repoDoc.repo_id,
    pageDocs.map((d) => d.artifact_id),
  );

  const items: EpicListItem[] = pageDocs.map((doc) => ({
    artifact_id: doc.artifact_id,
    title: doc.title,
    current_stage: doc.current_stage,
    needs_human: doc.needs_human,
    stalled_since: doc.stalled_since ? doc.stalled_since.toISOString() : null,
    child_counts: childCounts.get(doc.artifact_id) ?? {
      subtasks: 0,
      prs: 0,
      deploys: 0,
    },
    github_url: doc.github_url,
    last_event_at: doc.last_event_at.toISOString(),
  }));

  let next_cursor: string | null = null;
  if (hasMore) {
    const last = pageDocs[pageDocs.length - 1] as ShipLoopArtifact & {
      _id: ObjectId;
    };
    next_cursor = makeCursor({
      t: last.last_event_at.toISOString(),
      id: last._id.toString(),
    });
  }

  const body: EpicListResponse = { items, next_cursor };
  return Response.json(body);
}

/**
 * Load child counts for a batch of Epics with one aggregation. We
 * group on (epic_id, kind) so a single round-trip covers any number
 * of Epics on the page.
 */
async function loadChildCountsForEpics(
  repoId: string,
  epicIds: string[],
): Promise<Map<string, { subtasks: number; prs: number; deploys: number }>> {
  const out = new Map<
    string,
    { subtasks: number; prs: number; deploys: number }
  >();
  if (epicIds.length === 0) return out;

  const artifacts = await getShipLoopArtifactsCollection();
  const rows = await artifacts
    .aggregate<{ _id: { epic_id: string; kind: string }; n: number }>([
      {
        $match: {
          repo_id: repoId,
          epic_id: { $in: epicIds },
          kind: { $in: ["subtask", "pull_request", "deploy"] },
        },
      },
      { $group: { _id: { epic_id: "$epic_id", kind: "$kind" }, n: { $sum: 1 } } },
    ])
    .toArray();

  for (const id of epicIds) out.set(id, { subtasks: 0, prs: 0, deploys: 0 });
  for (const row of rows) {
    const bucket = out.get(row._id.epic_id);
    if (!bucket) continue;
    if (row._id.kind === "subtask") bucket.subtasks = row.n;
    else if (row._id.kind === "pull_request") bucket.prs = row.n;
    else if (row._id.kind === "deploy") bucket.deploys = row.n;
  }
  return out;
}

export const GET = withShipLoopGate(handle);
