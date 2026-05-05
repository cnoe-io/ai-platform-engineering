/**
 * Skill scan-override history — append-only audit log for admin
 * overrides of skill-scanner verdicts.
 *
 * Persists into Mongo collection `skill_scan_override_history`. One
 * row per `set` and per `clear` action; designed to never block the
 * mutating action (write failures are logged and swallowed). Lives
 * separately from `skill_scan_history` so the rare/sensitive admin
 * action audit trail isn't co-mingled with the high-volume scan-event
 * stream — different retention, different access controls, different
 * compliance reviews.
 *
 * Schema parity with `skill-scan-history.ts`: same `id` convention,
 * same `ts` Date column, same source-kind union, same swallow-on-
 * failure pattern. Future work: an admin UI page that joins this
 * collection with `agent_skills` to render "what's currently
 * overridden, by whom, and why".
 *
 * assisted-by Cursor Composer-Sonnet-4.7
 */

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { SkillSourceKind } from "@/lib/skill-scan-history";

/**
 * The action recorded.
 *
 * - ``set``    — admin created an override on a previously-flagged
 *                skill. Carries the admin's reason.
 * - ``clear``  — admin removed an override (UI button), or the
 *                automatic post-rescan revert (when a passing rescan
 *                lands on an overridden skill, see issue 4 in the
 *                rescan-revert task). The actor field distinguishes
 *                "alice@example.com" from "system:scanner".
 */
export type ScanOverrideAction = "set" | "clear";

export interface SkillScanOverrideHistoryDoc {
  /** Stable event id (timestamp+random suffix). */
  id: string;
  /** When the action was recorded (server time). */
  ts: Date;
  action: ScanOverrideAction;
  /**
   * Logical skill identity. Same conventions as
   * skill-scan-history.SkillScanHistoryDoc.skill_id so a future
   * admin UI can join the two collections by (source, skill_id).
   */
  skill_id: string;
  skill_name?: string;
  source: SkillSourceKind;
  /**
   * Identity of the actor responsible for the action.
   *
   *   - For UI-driven set/clear: the admin's email
   *     (``alice@example.com``).
   *   - For the auto-revert on a clean rescan: the literal string
   *     ``"system:scanner"`` so audit reviewers can immediately tell
   *     human action from system action.
   */
  actor: string;
  /**
   * Free-form admin justification on ``set``. On ``clear`` we still
   * accept a reason (e.g. "Skill rewritten, no longer needs
   * override") but it's optional — and on the system auto-revert
   * we hard-code "Scanner returned passed" so the audit row is
   * self-describing.
   */
  reason?: string;
  /**
   * Snapshot of ``scan_status`` at the moment of action. For ``set``
   * this is always ``"flagged"`` (the only state from which an
   * override is valid). For ``clear`` it's whatever the doc held
   * at clear time — usually ``"admin_overridden"`` for a manual
   * clear, or the new ``"passed"`` value the rescan wrote for the
   * auto-revert. Stored as the broader persisted union so future
   * statuses won't break this audit chain.
   */
  prior_scan_status?: "flagged" | "admin_overridden" | "passed" | "unscanned";
  /**
   * Snapshot of ``scan_summary`` at the moment of action. Useful so
   * an audit reviewer can see the scanner's reasoning at the time
   * an admin chose to override even after the scan summary itself
   * has been updated by a later rescan.
   */
  prior_scan_summary?: string;
}

const COLLECTION = "skill_scan_override_history";

function makeId(): string {
  // Same id convention as skill-scan-history so future joiners /
  // exporters don't have to special-case the collections.
  return `override-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Append a single audit row to ``skill_scan_override_history``.
 *
 * Swallows write failures by design: the override is the operator's
 * intent, the audit row is the log of that intent. We must never
 * block the override on a logging failure (would create an
 * availability dependency between Mongo's write health and the
 * security workflow). Failures are logged so they show up in the
 * normal application-error stream and operators can investigate.
 *
 * Treats a missing Mongo as a no-op for parity with
 * ``recordScanEvent``: in deployments without Mongo configured,
 * agent_skills collection isn't backing the catalog anyway, so
 * there's no override doc to log.
 */
export async function recordScanOverrideEvent(
  event: Omit<SkillScanOverrideHistoryDoc, "id" | "ts"> & { ts?: Date },
): Promise<void> {
  if (!isMongoDBConfigured) return;
  try {
    const col = await getCollection<SkillScanOverrideHistoryDoc>(COLLECTION);
    await col.insertOne({
      id: makeId(),
      ts: event.ts ?? new Date(),
      ...event,
    });
  } catch (err) {
    // Same shape as recordScanEvent's catch — keeps the search
    // pattern uniform for operators triaging audit-pipeline issues.
    console.warn(
      "[skill-scan-override-history] failed to record event:",
      err,
    );
  }
}
