#!/usr/bin/env -S node --enable-source-maps
/**
 * Idempotent index creation for the three Ship Loop MongoDB collections.
 * Run manually at deploy time:
 *
 *   npx ts-node ui/scripts/create-ship-loop-indexes.ts
 *   # or via the package script
 *   npm run ship-loop:create-indexes
 *
 * Re-running is a no-op once indexes exist. The script does NOT take any
 * destructive actions.
 */

import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DATABASE = process.env.MONGODB_DATABASE;

const REPOS = "ship_loop_repos";
const EVENTS = "ship_loop_events";
const ARTIFACTS = "ship_loop_artifacts";

const TTL_DAYS = Number(process.env.SHIP_LOOP_EVENTS_TTL_DAYS ?? "90");
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;

async function main(): Promise<void> {
  if (!MONGODB_URI || !MONGODB_DATABASE) {
    console.error(
      "❌ MONGODB_URI and MONGODB_DATABASE must be set before running this script.",
    );
    process.exit(1);
  }

  console.log(`Connecting to MongoDB database "${MONGODB_DATABASE}"...`);
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 4,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 10_000,
  });
  await client.connect();
  const db = client.db(MONGODB_DATABASE);

  let created = 0;
  let skipped = 0;

  async function safe(
    coll: string,
    keys: Record<string, 1 | -1>,
    options: Parameters<ReturnType<typeof db.collection>["createIndex"]>[1] = {},
    name?: string,
  ): Promise<void> {
    try {
      await db.collection(coll).createIndex(keys, { name, ...options });
      console.log(
        `  ✅ ${coll}.${name ?? JSON.stringify(keys)} ensured`,
      );
      created++;
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      // 85 = IndexOptionsConflict, 86 = IndexKeySpecsConflict — index already
      // exists with different options; treat as already-present.
      if (code === 85 || code === 86) {
        console.warn(
          `  ⚠️  ${coll}.${name ?? JSON.stringify(keys)} already exists with different options — leaving alone`,
        );
        skipped++;
        return;
      }
      console.error(
        `  ❌ ${coll}.${name ?? JSON.stringify(keys)} failed:`,
        err,
      );
      throw err;
    }
  }

  console.log(`\n[${REPOS}]`);
  await safe(
    REPOS,
    { repo_id: 1 },
    { unique: true },
    "repo_id_unique",
  );
  await safe(
    REPOS,
    { full_name: 1 },
    {
      unique: true,
      partialFilterExpression: { offboarded_at: null },
    },
    "full_name_unique_active",
  );
  await safe(
    REPOS,
    { webhook_id: 1 },
    { unique: true, sparse: true },
    "webhook_id_unique",
  );
  await safe(REPOS, { onboarded_at: -1 }, {}, "onboarded_at_desc");

  console.log(`\n[${EVENTS}]`);
  await safe(
    EVENTS,
    { repo_id: 1, github_delivery_id: 1 },
    {
      unique: true,
      partialFilterExpression: { source: "github" },
    },
    "github_idempotency",
  );
  await safe(
    EVENTS,
    { repo_id: 1, epic_id: 1, occurred_at: 1 },
    {},
    "epic_timeline",
  );
  await safe(
    EVENTS,
    { repo_id: 1, artifact_kind: 1, artifact_id: 1, occurred_at: 1 },
    {},
    "artifact_timeline",
  );
  await safe(
    EVENTS,
    { repo_id: 1, delivered_at: -1 },
    {},
    "recent_per_repo",
  );
  await safe(
    EVENTS,
    { projection_status: 1, delivered_at: 1 },
    {
      partialFilterExpression: {
        projection_status: { $in: ["deferred", "failed"] },
      },
    },
    "deferred_projection",
  );
  await safe(
    EVENTS,
    { delivered_at: 1 },
    { expireAfterSeconds: TTL_SECONDS },
    "ttl_90d",
  );

  console.log(`\n[${ARTIFACTS}]`);
  await safe(
    ARTIFACTS,
    { repo_id: 1, kind: 1, artifact_id: 1 },
    { unique: true },
    "artifact_unique",
  );
  await safe(
    ARTIFACTS,
    { repo_id: 1, epic_id: 1, kind: 1 },
    {},
    "epic_children",
  );
  await safe(
    ARTIFACTS,
    { repo_id: 1, current_stage: 1, last_event_at: -1 },
    {},
    "repo_stage_index",
  );
  await safe(
    ARTIFACTS,
    { needs_human: 1, requested_reviewers: 1, last_event_at: -1 },
    {},
    "needs_human_index",
  );
  await safe(
    ARTIFACTS,
    { repo_id: 1, stalled_since: 1 },
    { partialFilterExpression: { stalled_since: { $type: "date" } } },
    "stalled_index",
  );

  console.log(
    `\n✅ Done — created/ensured ${created} indexes, skipped ${skipped} pre-existing-with-different-options.`,
  );

  await client.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
