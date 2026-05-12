/**
 * Audit log assertion helpers (TypeScript side) — spec 102 T018.
 *
 * Parity with `tests/rbac/fixtures/audit.py`. See its header for the
 * collection-naming caveat (`authz_decisions` vs legacy
 * `authorization_decision_records`).
 *
 * The MongoClient is created lazily per call so tests don't pay the
 * connection cost when not asserting on the audit log.
 */

import { MongoClient } from "mongodb";

export const REQUIRED_REASONS = new Set([
  "OK",
  "OK_ROLE_FALLBACK",
  "OK_BOOTSTRAP_ADMIN",
  "DENY_NO_CAPABILITY",
  "DENY_PDP_UNAVAILABLE",
  "DENY_INVALID_TOKEN",
  "DENY_RESOURCE_UNKNOWN",
] as const);

export type AuditReason =
  | "OK"
  | "OK_ROLE_FALLBACK"
  | "OK_BOOTSTRAP_ADMIN"
  | "DENY_NO_CAPABILITY"
  | "DENY_PDP_UNAVAILABLE"
  | "DENY_INVALID_TOKEN"
  | "DENY_RESOURCE_UNKNOWN";

export interface AuditRecord {
  _id?: unknown;
  userId: string;
  userEmail?: string;
  resource: string;
  scope: string;
  allowed: boolean;
  reason: AuditReason;
  source: "ts" | "py";
  service: string;
  route?: string;
  requestId?: string;
  pdp?: "keycloak" | "local" | "cache";
  ts: Date | string;
}

function mongoUri(): string {
  return process.env.AUTHZ_MONGO_URI ?? process.env.MONGO_URI ?? "mongodb://localhost:27017";
}

function mongoDbName(): string {
  return process.env.AUTHZ_MONGO_DB ?? "caipe";
}

async function withClient<T>(fn: (db: ReturnType<MongoClient["db"]>) => Promise<T>): Promise<T> {
  const client = new MongoClient(mongoUri(), { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    return await fn(client.db(mongoDbName()));
  } finally {
    await client.close().catch(() => {});
  }
}

export interface AssertOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export async function assertAuditRecord(
  userId: string,
  resource: string,
  scope: string,
  allowed: boolean,
  reason: AuditReason,
  opts: AssertOptions = {},
): Promise<AuditRecord> {
  if (!REQUIRED_REASONS.has(reason)) {
    throw new Error(`reason ${reason} not in canonical enum`);
  }
  const timeoutMs = opts.timeoutMs ?? 5000;
  const pollIntervalMs = opts.pollIntervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let lastSeen: AuditRecord | null = null;

  return withClient(async (db) => {
    while (Date.now() < deadline) {
      for (const collectionName of ["authz_decisions", "authorization_decision_records"] as const) {
        const doc = (await db
          .collection<AuditRecord>(collectionName)
          .findOne({ userId, resource, scope }, { sort: { ts: -1 } })) as AuditRecord | null;
        if (doc === null) continue;
        lastSeen = doc;
        if (Boolean(doc.allowed) === allowed && doc.reason === reason) {
          return doc;
        }
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(
      `no matching audit record within ${timeoutMs}ms — looked for ` +
        `userId=${userId}, resource=${resource}, scope=${scope}, ` +
        `allowed=${allowed}, reason=${reason}; last seen=${JSON.stringify(lastSeen)}`,
    );
  });
}

export async function clearAuditLog(): Promise<number> {
  return withClient(async (db) => {
    let deleted = 0;
    for (const collectionName of ["authz_decisions", "authorization_decision_records"] as const) {
      try {
        const res = await db.collection(collectionName).deleteMany({});
        deleted += res.deletedCount ?? 0;
      } catch {
        // best-effort
      }
    }
    return deleted;
  });
}

export async function latestAuditRecordFor(userId: string): Promise<AuditRecord | null> {
  return withClient(async (db) => {
    for (const collectionName of ["authz_decisions", "authorization_decision_records"] as const) {
      const doc = (await db
        .collection<AuditRecord>(collectionName)
        .findOne({ userId }, { sort: { ts: -1 } })) as AuditRecord | null;
      if (doc !== null) return doc;
    }
    return null;
  });
}
