/**
 * Audit / health-check: ensure every conversation whose creator was a
 * service account has the corresponding
 *   service_account:<sub>  writer  conversation:<id>
 * OpenFGA grant. This is the backstop for the best-effort auto-grant
 * written at create time in api/chat/conversations/route.ts.
 *
 * Design choices (matching unlinked-service-account.ts + ensureSuperAdminsTeam):
 *  - NEVER THROWS: all errors are collected in `warnings`.
 *  - Idempotent: writeOpenFgaTuples skips tuples that already exist.
 *  - Bounded: processes at most MAX_SA_CONVERSATIONS per run to keep
 *    startup latency predictable; logs a warning when capped.
 *
 * assisted-by Claude:claude-sonnet-4-6
 */

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { writeOpenFgaTuples } from "@/lib/rbac/openfga";
import type { Conversation } from "@/types/mongodb";

// Cap to avoid blocking startup on large deployments.
const MAX_SA_CONVERSATIONS = 500;

export interface SaConversationReconcileResult {
  /** How many SA-created conversations were found (up to MAX_SA_CONVERSATIONS). */
  scanned: number;
  /** How many new writer tuples were written. */
  backfilled: number;
  /** Whether the scan was truncated by the cap. */
  capped: boolean;
  warnings: string[];
}

/**
 * Scan conversations created by service accounts and backfill any missing
 * `service_account:<sub> writer conversation:<id>` OpenFGA tuples.
 *
 * Called from `runKeycloakRbacStartupMigration` after the unlinked SA
 * bootstrap step.
 */
export async function reconcileSaConversationWriterGrants(input: {
  /** Used only for log attribution. */
  actor?: string;
}): Promise<SaConversationReconcileResult> {
  const warnings: string[] = [];
  const actor = (input.actor ?? "").trim() || "startup";

  if (!isMongoDBConfigured) {
    return { scanned: 0, backfilled: 0, capped: false, warnings: ["MongoDB not configured; SA conversation reconcile skipped"] };
  }

  let scanned = 0;
  let backfilled = 0;
  let capped = false;

  try {
    const conversations = await getCollection<Conversation>("conversations");

    // Only look at docs where created_by_service_account is set (sparse field).
    const cursor = conversations.find(
      { created_by_service_account: { $exists: true, $ne: null } },
      { projection: { _id: 1, created_by_service_account: 1 }, limit: MAX_SA_CONVERSATIONS + 1 }
    );

    const docs = await cursor.toArray();

    if (docs.length > MAX_SA_CONVERSATIONS) {
      capped = true;
      warnings.push(
        `[sa-conversation-reconcile] Capped at ${MAX_SA_CONVERSATIONS} SA-created conversations ` +
        `(actor=${actor}). Run again to process the rest.`
      );
      docs.splice(MAX_SA_CONVERSATIONS);
    }

    scanned = docs.length;

    // Collect all missing-tuple writes in one pass.
    // SEC-7: coerce _id via String() before .trim() — MongoDB ObjectId instances
    // are not strings but have a useful .toString(); a non-string _id must not throw.
    const writes = docs
      .filter((doc): doc is Conversation & { created_by_service_account: string } => {
        const sub = doc.created_by_service_account;
        const id = String(doc._id ?? '').trim();
        return typeof sub === 'string' && sub.trim() !== '' && id !== '';
      })
      .map((doc) => ({
        user: `service_account:${doc.created_by_service_account.trim()}`,
        relation: 'writer' as const,
        object: `conversation:${String(doc._id)}`,
      }));

    if (writes.length > 0) {
      try {
        const result = await writeOpenFgaTuples({ writes, deletes: [] });
        // writeOpenFgaTuples filters out already-existing tuples, so `result.writes`
        // is the number actually written (new tuples only).
        backfilled = result.writes;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`[sa-conversation-reconcile] OpenFGA batch write failed (actor=${actor}): ${message}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`[sa-conversation-reconcile] Scan failed (actor=${actor}): ${message}`);
  }

  return { scanned, backfilled, capped, warnings };
}
