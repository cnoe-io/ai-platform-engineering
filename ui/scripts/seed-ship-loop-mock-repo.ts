#!/usr/bin/env -S node --enable-source-maps
/**
 * Seed a mock OnboardedRepo so the mock webhook flow can target it.
 *
 * Why a script (not an API route): for the mock-webhook demo we want
 * a repeatable starting state without requiring GitHub OAuth or real
 * Octokit calls. This script writes a single `ship_loop_repos` row
 * with a deterministic repo_id (default: 99000001) and a known
 * webhook secret, then prints the secret + the matching env var line
 * for the operator to drop into ui/.env.local.
 *
 * The receiver uses GITHUB_WEBHOOK_SECRET to verify HMAC, so the
 * secret printed by this script MUST match what is in .env.local for
 * the dev server. A fingerprint hash is also stored on the repo doc
 * so a rotation (different secret in env) is rejected loudly.
 *
 * Usage:
 *   # default values, deterministic repo
 *   npm run ship-loop:seed-mock-repo
 *
 *   # custom secret + repo id
 *   SHIP_LOOP_MOCK_SECRET=my-test-secret \
 *   SHIP_LOOP_MOCK_REPO_ID=42424242 \
 *   SHIP_LOOP_MOCK_FULL_NAME=demoorg/agentic-demo \
 *     npm run ship-loop:seed-mock-repo
 *
 *   # delete the seeded repo (idempotent)
 *   SHIP_LOOP_MOCK_DELETE=1 npm run ship-loop:seed-mock-repo
 *
 * Re-running is safe: the script upserts on repo_id and re-prints the
 * env var line.
 *
 * No production data is touched -- the repo_id range 99_000_000+ is
 * outside any real GitHub repo id and is reserved for mocks.
 */

import { MongoClient } from "mongodb";
import { createHmac } from "node:crypto";

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DATABASE = process.env.MONGODB_DATABASE;

const REPOS = "ship_loop_repos";
const EVENTS = "ship_loop_events";
const ARTIFACTS = "ship_loop_artifacts";

// Defaults match the values used by scripts/mock-webhook-flow.sh.
const DEFAULT_SECRET = "ship-loop-mock-secret";
const DEFAULT_REPO_ID = "99000001";
const DEFAULT_FULL_NAME = "demoorg/agentic-demo";
const DEFAULT_SANDBOX_ENV = "sandbox-eks";

function hashWebhookSecret(secret: string): string {
  // Mirrors ui/src/lib/agentic-sdlc/webhook-verify.ts hashWebhookSecret().
  // Kept inline here so the script has zero src/ imports and runs
  // under plain ts-node without the Next.js path-alias resolver.
  return createHmac("sha256", "ship-loop-secret-fingerprint")
    .update(secret)
    .digest("hex");
}

async function main(): Promise<void> {
  if (!MONGODB_URI || !MONGODB_DATABASE) {
    console.error(
      "MONGODB_URI and MONGODB_DATABASE must be set before running this script.",
    );
    process.exit(1);
  }

  const secret = process.env.SHIP_LOOP_MOCK_SECRET ?? DEFAULT_SECRET;
  const repoId = process.env.SHIP_LOOP_MOCK_REPO_ID ?? DEFAULT_REPO_ID;
  const fullName = process.env.SHIP_LOOP_MOCK_FULL_NAME ?? DEFAULT_FULL_NAME;
  const [owner, name] = fullName.split("/");
  if (!owner || !name) {
    console.error(
      `SHIP_LOOP_MOCK_FULL_NAME must be in <owner>/<repo> form (got "${fullName}").`,
    );
    process.exit(1);
  }
  const shouldDelete = process.env.SHIP_LOOP_MOCK_DELETE === "1";

  console.log(`Connecting to MongoDB database "${MONGODB_DATABASE}"...`);
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 4,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 10_000,
  });
  await client.connect();
  const db = client.db(MONGODB_DATABASE);

  if (shouldDelete) {
    const repoRes = await db.collection(REPOS).deleteOne({ repo_id: repoId });
    const evRes = await db.collection(EVENTS).deleteMany({ repo_id: repoId });
    const artRes = await db
      .collection(ARTIFACTS)
      .deleteMany({ repo_id: repoId });
    console.log(
      `Removed: repos=${repoRes.deletedCount}, events=${evRes.deletedCount}, artifacts=${artRes.deletedCount}`,
    );
    await client.close();
    return;
  }

  const now = new Date();
  const update = {
    $set: {
      repo_id: repoId,
      owner,
      name,
      full_name: fullName,
      default_branch: "main",
      sandbox_environment: DEFAULT_SANDBOX_ENV,
      webhook_id: 1, // placeholder; real onboarding fills this
      webhook_secret_hash: hashWebhookSecret(secret),
      webhook_status: "healthy",
      webhook_last_event_at: null,
      label_to_stage_overrides: {},
      onboarded_by_user_id: "mock-seed-script",
      offboarded_at: null,
      updated_at: now,
    },
    $setOnInsert: {
      onboarded_at: now,
      created_at: now,
    },
  };

  await db
    .collection(REPOS)
    .updateOne({ repo_id: repoId }, update, { upsert: true });

  console.log("");
  console.log("Mock OnboardedRepo seeded:");
  console.log(`  repo_id            : ${repoId}`);
  console.log(`  full_name          : ${fullName}`);
  console.log(`  sandbox_environment: ${DEFAULT_SANDBOX_ENV}`);
  console.log("");
  console.log("Add this line to ui/.env.local (or export in your shell)");
  console.log("so the receiver verifies HMAC against the same secret:");
  console.log("");
  console.log(`  GITHUB_WEBHOOK_SECRET=${secret}`);
  console.log("");
  console.log("Then restart the dev server.");
  console.log("");
  console.log("To remove the mock data:");
  console.log("  SHIP_LOOP_MOCK_DELETE=1 npm run ship-loop:seed-mock-repo");

  await client.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
