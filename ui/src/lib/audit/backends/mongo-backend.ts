// assisted-by claude code claude-sonnet-4-6
/**
 * MongoDB audit log backend (default).
 *
 * Preserves the original dual-write behaviour from rbac/audit.ts:
 *   1. authorization_decision_records  (legacy RBAC collection)
 *   2. audit_events                    (unified collection, FR-037)
 *
 * Active only when AUDIT_LOG_BACKEND=mongodb (or unset).
 */

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { AuditBackend } from "../backend";

const AUTHORIZATION_DECISION_RECORDS = "authorization_decision_records";
const AUDIT_EVENTS = "audit_events";

export class MongoBackend implements AuditBackend {
  write(event: Record<string, unknown>): void {
    if (!isMongoDBConfigured) return;
    void this._writeAsync(event);
  }

  private async _writeAsync(event: Record<string, unknown>): Promise<void> {
    const tsDate =
      event["ts"] instanceof Date
        ? event["ts"]
        : typeof event["ts"] === "string"
          ? new Date(event["ts"])
          : new Date();

    // Legacy collection: authorization decisions only
    if (event["type"] === "auth" || event["type"] === "openfga_rebac" || event["type"] === "cas_decision") {
      try {
        const authzColl = await getCollection<Record<string, unknown>>(
          AUTHORIZATION_DECISION_RECORDS,
        );
        await authzColl.insertOne({ ...event, ts: tsDate });
      } catch (err) {
        console.warn("[audit/mongo] Failed to persist to authorization_decision_records:", err);
      }
    }

    // Unified collection: all event types
    try {
      const auditColl = await getCollection<Record<string, unknown>>(AUDIT_EVENTS);
      await auditColl.insertOne({ ...event, ts: tsDate });
    } catch (err) {
      console.warn("[audit/mongo] Failed to persist to audit_events:", err);
    }
  }
}
