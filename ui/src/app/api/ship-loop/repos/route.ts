/**
 * GET /api/ship-loop/repos
 *
 * Lists active onboarded repos with per-repo counts. Auth model:
 *   - Always 404 when SHIP_LOOP_ENABLED=false (server gate).
 *   - In production, requires a NextAuth session (401 otherwise).
 *   - In dev, SHIP_LOOP_ALLOW_NO_AUTH=true bypasses the session check
 *     so the mock-webhook flow can be driven without OAuth.
 *
 * Pilot scope: returns *every* active repo. The full spec restricts
 * the list by GitHub repo visibility for the calling user; that
 * filter is intentionally deferred (see tasks T031-T033 / FR-029)
 * because (a) the mock flow needs deterministic output and (b)
 * GitHub OAuth wiring is its own commit. When the visibility filter
 * lands, replace the `find({offboarded_at: null})` below with the
 * user-scoped query.
 */

import {
  getShipLoopReposCollection,
} from "@/lib/ship-loop/mongo-collections";
import { withShipLoopGate } from "@/lib/ship-loop/guard";
import { getRepoCounts } from "@/lib/ship-loop/repo-stats";
import { requireShipLoopReader } from "@/lib/ship-loop/ship-loop-auth";
import type { OnboardedRepo } from "@/types/ship-loop";

interface RepoListItem {
  repo_id: string;
  owner: string;
  name: string;
  full_name: string;
  sandbox_environment: string;
  webhook_status: OnboardedRepo["webhook_status"];
  counts: {
    open_epics: number;
    in_flight_subtasks: number;
    prs_awaiting_review: number;
    deploys_24h: number;
  };
}

async function handle(req: Request): Promise<Response> {
  const reader = await requireShipLoopReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }

  const repos = await getShipLoopReposCollection();
  const cursor = repos
    .find(
      { offboarded_at: null },
      {
        projection: {
          _id: 0,
          repo_id: 1,
          owner: 1,
          name: 1,
          full_name: 1,
          sandbox_environment: 1,
          webhook_status: 1,
        },
        sort: { onboarded_at: -1 },
        limit: 100,
      },
    );

  const docs = await cursor.toArray();

  const items: RepoListItem[] = await Promise.all(
    docs.map(async (doc) => ({
      repo_id: doc.repo_id,
      owner: doc.owner,
      name: doc.name,
      full_name: doc.full_name,
      sandbox_environment: doc.sandbox_environment,
      webhook_status: doc.webhook_status,
      counts: await getRepoCounts(doc.repo_id),
    })),
  );

  return Response.json({ items });
}

export const GET = withShipLoopGate(handle);
