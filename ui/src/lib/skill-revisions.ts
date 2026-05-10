/**
 * Skill content revisions — append-only per-skill version history.
 *
 * Persists into Mongo collection `skill_revisions`. One row is written
 * every time a skill's content changes (create, update, per-file edit,
 * clone, zip-import) so users can see the editing timeline and restore
 * an earlier snapshot.
 *
 * Retention is bounded: only the most recent
 * {@link MAX_REVISIONS_PER_SKILL} (default 10) rows are kept per
 * `skill_id`. Older rows are pruned synchronously at write time so
 * the collection can't grow without bound, even on a busy auto-save
 * loop.
 *
 * Design notes:
 *   * Writes are best-effort: if Mongo is unconfigured or the
 *     insert/prune fails we log and swallow — versioning is a UX
 *     nicety, not a correctness gate. Save itself must never break
 *     because history couldn't be written.
 *   * We capture a full content snapshot rather than a diff. Diffs
 *     are computed on read by the UI; storing snapshots keeps the
 *     restore path trivially correct (overwrite current with the
 *     selected revision) and avoids the chain-reconstruction
 *     pitfalls of diff-based history when rows are pruned out from
 *     under us.
 *   * Administrative fields (owner_id, is_system, visibility,
 *     shared_with_teams) are deliberately NOT snapshotted — they're
 *     authorization state, not content, and a "restore" should never
 *     change who owns the skill or who can see it.
 */

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type {
  AgentSkill,
  AgentSkillCategory,
  AgentSkillMetadata,
  AgentSkillTask,
  WorkflowDifficulty,
  WorkflowInputForm,
  ScanStatus,
} from "@/types/agent-skill";

/** Triggers that produce a new revision row. Mirrors `ScanTrigger` shape. */
export type RevisionTrigger =
  /** New skill row created via POST /api/skills/configs. */
  | "create"
  /** Full-skill update via PUT /api/skills/configs?id=... */
  | "update"
  /** Single-file save via PUT /api/skills/configs/[id]/files. */
  | "file_edit"
  /** Single-file delete via DELETE /api/skills/configs/[id]/files. */
  | "file_delete"
  /** New skill produced by POST /api/skills/configs/[id]/clone. */
  | "clone"
  /** New skill produced by zip-import (commit 3). */
  | "import"
  /** Programmatic restore from an earlier revision. */
  | "restore";

export interface SkillRevisionDoc {
  /** Stable revision id (timestamp + random suffix). */
  id: string;
  /** Logical skill identity (Mongo `id` on `agent_skills`). */
  skill_id: string;
  /** Wall-clock timestamp this revision was captured. */
  created_at: Date;
  /** Email / display name of whoever triggered the snapshot. */
  actor?: string;
  /** Why this revision was written. */
  trigger: RevisionTrigger;
  /** Monotonic per-skill counter (1, 2, 3...). */
  revision_number: number;
  /**
   * If this revision was produced by restoring an earlier snapshot,
   * the id of the source revision. Lets the UI render
   * "Revision 7 — restored from Revision 3".
   */
  restored_from?: string;
  /** Free-form note (e.g. "imported from foo.zip"). */
  note?: string;

  // ---- content snapshot (matches AgentSkill content fields) ----
  name: string;
  description?: string;
  category: AgentSkillCategory | string;
  tasks: AgentSkillTask[];
  metadata?: AgentSkillMetadata;
  is_quick_start?: boolean;
  difficulty?: WorkflowDifficulty;
  thumbnail?: string;
  input_form?: WorkflowInputForm;
  skill_content?: string;
  ancillary_files?: Record<string, string>;
  scan_status?: ScanStatus;
  scan_summary?: string;
}

/** Public shape returned from {@link listRevisions} — strips Mongo internals. */
export type SkillRevisionSummary = Omit<
  SkillRevisionDoc,
  "skill_content" | "ancillary_files"
> & {
  /** Byte size of the SKILL.md snapshot, for display ("3.4 KB"). */
  skill_content_size: number;
  /** Number of ancillary files in the snapshot. */
  ancillary_file_count: number;
  /** Total bytes across all ancillary files. */
  ancillary_total_size: number;
};

const COLLECTION = "skill_revisions";

/**
 * Maximum revisions retained per skill. Older rows are pruned at
 * write time. Chosen as a small bounded value: enough for a typical
 * "oops, undo" workflow without growing without bound on a tight
 * auto-save loop. Tunable via env for ops emergencies.
 */
export const MAX_REVISIONS_PER_SKILL: number = (() => {
  const raw = process.env.SKILL_REVISIONS_RETENTION;
  if (!raw) return 10;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  // Hard upper bound — nobody should be configuring 10_000 rows per
  // skill, and the synchronous prune step starts to matter as N grows.
  return Math.min(parsed, 1000);
})();

function makeRevisionId(): string {
  return `rev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Snapshot-capable subset of {@link AgentSkill}. Anything outside this
 * shape is administrative metadata and is excluded from history.
 */
export type SkillSnapshotInput = Pick<
  AgentSkill,
  | "name"
  | "description"
  | "category"
  | "tasks"
  | "metadata"
  | "is_quick_start"
  | "difficulty"
  | "thumbnail"
  | "input_form"
  | "skill_content"
  | "ancillary_files"
  | "scan_status"
  | "scan_summary"
>;

/**
 * Append a revision for `skillId`, then prune older rows past
 * {@link MAX_REVISIONS_PER_SKILL}.
 *
 * Best-effort: a failure here logs and returns silently rather than
 * propagating up to the caller's save flow.
 */
export async function recordRevision(args: {
  skillId: string;
  snapshot: SkillSnapshotInput;
  trigger: RevisionTrigger;
  actor?: string;
  note?: string;
  restoredFrom?: string;
}): Promise<SkillRevisionDoc | null> {
  if (!isMongoDBConfigured) return null;
  try {
    const col = await getCollection<SkillRevisionDoc>(COLLECTION);

    // Derive the next revision number by inspecting the most recent
    // existing row. We use `created_at` rather than insertion order
    // so the counter is stable even if a clock skew or out-of-order
    // write briefly appears.
    const last = await col
      .find({ skill_id: args.skillId })
      .sort({ revision_number: -1 })
      .limit(1)
      .project<{ revision_number?: number }>({ revision_number: 1, _id: 0 })
      .toArray();
    const nextNumber = (last[0]?.revision_number ?? 0) + 1;

    const doc: SkillRevisionDoc = {
      id: makeRevisionId(),
      skill_id: args.skillId,
      created_at: new Date(),
      actor: args.actor,
      trigger: args.trigger,
      revision_number: nextNumber,
      restored_from: args.restoredFrom,
      note: args.note,
      // Spread the snapshot last so it can't override the
      // identity / accounting fields above (e.g. a malicious caller
      // can't pass `id: "..."` inside the snapshot to overwrite
      // another row's revision id).
      name: args.snapshot.name,
      description: args.snapshot.description,
      category: args.snapshot.category,
      tasks: args.snapshot.tasks ?? [],
      metadata: args.snapshot.metadata,
      is_quick_start: args.snapshot.is_quick_start,
      difficulty: args.snapshot.difficulty,
      thumbnail: args.snapshot.thumbnail,
      input_form: args.snapshot.input_form,
      skill_content: args.snapshot.skill_content,
      ancillary_files: args.snapshot.ancillary_files,
      scan_status: args.snapshot.scan_status,
      scan_summary: args.snapshot.scan_summary,
    };

    await col.insertOne(doc);
    await pruneToRetention(args.skillId, MAX_REVISIONS_PER_SKILL);
    return doc;
  } catch (err) {
    console.warn("[skill-revisions] failed to record revision:", err);
    return null;
  }
}

/**
 * Drop revisions for `skillId` past the most recent `keep` rows.
 * Exposed for tests and explicit cleanup; normal callers go through
 * {@link recordRevision}.
 */
export async function pruneToRetention(
  skillId: string,
  keep: number,
): Promise<{ pruned: number }> {
  if (!isMongoDBConfigured) return { pruned: 0 };
  if (keep <= 0) return { pruned: 0 };
  try {
    const col = await getCollection<SkillRevisionDoc>(COLLECTION);
    // Find the rows we want to keep, then delete everything older.
    // We delete by `id` so an out-of-order timestamp can't strand
    // an old row on top of the keep window.
    const toKeep = await col
      .find({ skill_id: skillId })
      .sort({ revision_number: -1 })
      .limit(keep)
      .project<{ id: string }>({ id: 1, _id: 0 })
      .toArray();
    const keepIds = toKeep.map((d) => d.id);
    const result = await col.deleteMany({
      skill_id: skillId,
      id: { $nin: keepIds },
    });
    return { pruned: result.deletedCount ?? 0 };
  } catch (err) {
    console.warn("[skill-revisions] prune failed:", err);
    return { pruned: 0 };
  }
}

/**
 * Return the revision summaries for `skillId`, newest first. The
 * heavy fields (SKILL.md body, ancillary file contents) are stripped
 * so the list endpoint stays cheap; use {@link getRevision} to fetch
 * a single full revision for diff/restore.
 */
export async function listRevisions(
  skillId: string,
  opts: { limit?: number } = {},
): Promise<SkillRevisionSummary[]> {
  if (!isMongoDBConfigured) return [];
  try {
    const limit = Math.min(MAX_REVISIONS_PER_SKILL, Math.max(1, opts.limit ?? MAX_REVISIONS_PER_SKILL));
    const col = await getCollection<SkillRevisionDoc>(COLLECTION);
    const rows = await col
      .find({ skill_id: skillId })
      .sort({ revision_number: -1 })
      .limit(limit)
      .project<SkillRevisionDoc>({ _id: 0 })
      .toArray();
    return rows.map(toSummary);
  } catch (err) {
    console.warn("[skill-revisions] listRevisions failed:", err);
    return [];
  }
}

/**
 * Fetch a single full revision (with content) by its revision id.
 * Returns `null` if not found.
 */
export async function getRevision(
  skillId: string,
  revisionId: string,
): Promise<SkillRevisionDoc | null> {
  if (!isMongoDBConfigured) return null;
  try {
    const col = await getCollection<SkillRevisionDoc>(COLLECTION);
    const row = await col
      .findOne({ skill_id: skillId, id: revisionId }, { projection: { _id: 0 } });
    return row ?? null;
  } catch (err) {
    console.warn("[skill-revisions] getRevision failed:", err);
    return null;
  }
}

/**
 * Delete every revision for `skillId`. Called when a skill is hard
 * deleted so we don't leak orphaned history rows. Best-effort.
 */
export async function deleteRevisionsForSkill(
  skillId: string,
): Promise<{ deleted: number }> {
  if (!isMongoDBConfigured) return { deleted: 0 };
  try {
    const col = await getCollection<SkillRevisionDoc>(COLLECTION);
    const result = await col.deleteMany({ skill_id: skillId });
    return { deleted: result.deletedCount ?? 0 };
  } catch (err) {
    console.warn("[skill-revisions] deleteRevisionsForSkill failed:", err);
    return { deleted: 0 };
  }
}

/**
 * Compare two snapshot inputs to decide whether a revision is worth
 * recording. Pure metadata-only edits (description, tags) still
 * generate a revision because the workspace shows them in the
 * timeline; the only reason to skip is when no observable field has
 * changed (e.g. the PUT handler is called with an empty body).
 *
 * Exposed for the routes that wrap `recordRevision` so they can
 * elide no-op writes and avoid burning through the retention window
 * on duplicate saves.
 */
export function snapshotsDiffer(
  prev: SkillSnapshotInput | null | undefined,
  next: SkillSnapshotInput,
): boolean {
  if (!prev) return true;
  if (prev.name !== next.name) return true;
  if ((prev.description ?? "") !== (next.description ?? "")) return true;
  if (prev.category !== next.category) return true;
  if ((prev.skill_content ?? "") !== (next.skill_content ?? "")) return true;
  if (prev.is_quick_start !== next.is_quick_start) return true;
  if (prev.difficulty !== next.difficulty) return true;
  if (prev.thumbnail !== next.thumbnail) return true;
  if (JSON.stringify(prev.tasks ?? []) !== JSON.stringify(next.tasks ?? [])) return true;
  if (JSON.stringify(prev.metadata ?? {}) !== JSON.stringify(next.metadata ?? {})) return true;
  if (JSON.stringify(prev.input_form ?? null) !== JSON.stringify(next.input_form ?? null)) return true;
  if (
    JSON.stringify(prev.ancillary_files ?? {}) !==
    JSON.stringify(next.ancillary_files ?? {})
  )
    return true;
  // We deliberately don't trip on scan_status alone — a scan-result
  // refresh without content change shouldn't burn a revision slot.
  return false;
}

/**
 * Collapse a {@link SkillRevisionDoc} into a list-view summary.
 */
function toSummary(doc: SkillRevisionDoc): SkillRevisionSummary {
  const skillContentSize = doc.skill_content
    ? Buffer.byteLength(doc.skill_content, "utf-8")
    : 0;
  const ancillary = doc.ancillary_files ?? {};
  const ancillaryCount = Object.keys(ancillary).length;
  const ancillaryTotal = Object.values(ancillary).reduce(
    (sum, v) => sum + Buffer.byteLength(v, "utf-8"),
    0,
  );
  // We strip the heavy fields explicitly so a future addition to
  // SkillRevisionDoc can't accidentally leak into the list endpoint.
  const {
    skill_content: _skillContent,
    ancillary_files: _ancillary,
    ...rest
  } = doc;
  void _skillContent;
  void _ancillary;
  return {
    ...rest,
    skill_content_size: skillContentSize,
    ancillary_file_count: ancillaryCount,
    ancillary_total_size: ancillaryTotal,
  };
}
