import type { MigrationApplyResult, MigrationPlanResult } from "./types";

// 0.6.0 cleanup of artifacts left behind by the supervisor + A2A
// standalone-agent removal (branch feat/remove-supervisor-and-a2a-agents).
//
// Three side effects, all idempotent:
//   1. Drop orphaned per-agent LangGraph checkpoint collections. The unified
//      dynamic-agents runtime writes only to `checkpoints_conversation` /
//      `checkpoint_writes_conversation`; the workflow engine uses
//      `workflow_checkpoints` / `workflow_checkpoints_writes`. Every other
//      `checkpoints_*` / `checkpoint_writes_*` collection was created by a
//      now-deleted supervisor or standalone sub-agent and is dead state.
//   2. `$unset` the deprecated A2A-era `metadata.agent_version` /
//      `metadata.model_used` fields on conversations.
//   3. `$unset` the dead `a2a_events` array on messages (the A2A client that
//      produced it was removed; the live flow persists `stream_events`).
//
// Conversation/message STAT data (counts, tokens, feedback, agent_name) lives
// in the `conversations` / `messages` / `feedback` collections and is NOT
// touched here — only the dead fields and orphaned checkpoint collections go.

export const LEGACY_RUNTIME_CLEANUP_MIGRATION_ID = "legacy_runtime_cleanup_v1";
export const LEGACY_RUNTIME_CLEANUP_CONFIRMATION = "MIGRATE legacy_runtime_cleanup TO v2";

/** Checkpoint collection name prefixes that are still actively written. */
const CHECKPOINT_PREFIXES = ["checkpoints_", "checkpoint_writes_"] as const;

/**
 * Collections that must survive the drop. The dynamic-agents runtime default
 * (`checkpoints_conversation` + writes) and the workflow engine
 * (`workflow_checkpoints` + writes). Keep these in sync with
 * `dynamic_agents/config.py` and `ui/src/lib/server/workflow-engine.ts`.
 */
export const PRESERVED_CHECKPOINT_COLLECTIONS = new Set<string>([
  "checkpoints_conversation",
  "checkpoint_writes_conversation",
  "workflow_checkpoints",
  "workflow_checkpoints_writes",
]);

/** True for a checkpoint/checkpoint-writes collection that is NOT preserved. */
export function isOrphanedCheckpointCollection(name: string): boolean {
  if (PRESERVED_CHECKPOINT_COLLECTIONS.has(name)) return false;
  if (name.startsWith("system.")) return false;
  return CHECKPOINT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

interface DeriveLegacyRuntimeCleanupPlanInput {
  /** All MongoDB collection names (from listCollections). */
  collectionNames: string[];
  /** Count of conversations still carrying deprecated metadata fields. */
  conversationsWithDeprecatedFields: number;
  /** Count of messages still carrying a dead `a2a_events` array. */
  messagesWithA2aEvents: number;
}

interface LegacyRuntimeCleanupCollections {
  conversations: {
    countDocuments: (filter: Record<string, unknown>) => Promise<number>;
    updateMany: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ) => Promise<{ modifiedCount?: number }>;
  };
  messages: {
    countDocuments: (filter: Record<string, unknown>) => Promise<number>;
    updateMany: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ) => Promise<{ modifiedCount?: number }>;
  };
  listCollectionNames: () => Promise<string[]>;
  dropCollection: (name: string) => Promise<boolean>;
}

interface ApplyLegacyRuntimeCleanupInput {
  actor: string;
  now: string;
  collections: LegacyRuntimeCleanupCollections;
}

/** Filter matching conversations that still carry either deprecated field. */
export const DEPRECATED_CONVERSATION_FIELDS_FILTER: Record<string, unknown> = {
  $or: [
    { "metadata.agent_version": { $exists: true } },
    { "metadata.model_used": { $exists: true } },
  ],
};

/** Filter matching messages that still carry a dead a2a_events array. */
export const A2A_EVENTS_FILTER: Record<string, unknown> = { a2a_events: { $exists: true } };

export function deriveLegacyRuntimeCleanupPlan(
  input: DeriveLegacyRuntimeCleanupPlanInput,
): MigrationPlanResult {
  const orphanedCollections = input.collectionNames
    .filter(isOrphanedCheckpointCollection)
    .sort((left, right) => left.localeCompare(right));

  const sampleDiffs: MigrationPlanResult["sample_diffs"] = [];

  for (const collection of orphanedCollections.slice(0, 8)) {
    sampleDiffs.push({
      collection,
      id: collection,
      before: { exists: true },
      after: { dropped: true },
    });
  }
  if (input.conversationsWithDeprecatedFields > 0) {
    sampleDiffs.push({
      collection: "conversations",
      id: "metadata.agent_version / metadata.model_used",
      before: { "metadata.agent_version": "<set>", "metadata.model_used": "<set>" },
      after: { "metadata.agent_version": "<unset>", "metadata.model_used": "<unset>" },
    });
  }
  if (input.messagesWithA2aEvents > 0) {
    sampleDiffs.push({
      collection: "messages",
      id: "a2a_events",
      before: { a2a_events: "<array>" },
      after: { a2a_events: "<unset>" },
    });
  }

  const warnings: string[] = [];
  if (orphanedCollections.length > 0) {
    warnings.push(
      `Dropping ${orphanedCollections.length} orphaned checkpoint collection(s) left by removed supervisor/sub-agents. This is irreversible — back up MongoDB first if you want to retain that runtime state.`,
    );
  }

  return {
    migration_id: LEGACY_RUNTIME_CLEANUP_MIGRATION_ID,
    release: "0.6.0",
    schema_area: "legacy_runtime_cleanup",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      orphaned_checkpoint_collections: orphanedCollections.length,
      conversations_with_deprecated_fields: input.conversationsWithDeprecatedFields,
      messages_with_a2a_events: input.messagesWithA2aEvents,
      tuple_writes_planned: 0,
    },
    warnings,
    sample_diffs: sampleDiffs,
    tuple_writes_planned: 0,
    confirmation: LEGACY_RUNTIME_CLEANUP_CONFIRMATION,
  };
}

export async function applyLegacyRuntimeCleanupMigration(
  input: ApplyLegacyRuntimeCleanupInput,
): Promise<MigrationApplyResult> {
  const { collections } = input;

  // Re-read the live collection list and deprecated-field counts at apply time
  // so the plan embedded in the result reflects the exact state we acted on.
  const collectionNames = await collections.listCollectionNames();
  const [conversationsWithDeprecatedFields, messagesWithA2aEvents] = await Promise.all([
    collections.conversations.countDocuments(DEPRECATED_CONVERSATION_FIELDS_FILTER),
    collections.messages.countDocuments(A2A_EVENTS_FILTER),
  ]);

  const plan = deriveLegacyRuntimeCleanupPlan({
    collectionNames,
    conversationsWithDeprecatedFields,
    messagesWithA2aEvents,
  });

  const orphanedCollections = collectionNames
    .filter(isOrphanedCheckpointCollection)
    .sort((left, right) => left.localeCompare(right));

  let droppedCollections = 0;
  for (const collection of orphanedCollections) {
    const dropped = await collections.dropCollection(collection);
    if (dropped) droppedCollections += 1;
  }

  const conversationsResult = await collections.conversations.updateMany(
    DEPRECATED_CONVERSATION_FIELDS_FILTER,
    {
      $unset: { "metadata.agent_version": "", "metadata.model_used": "" },
      $set: { updated_at: input.now },
    },
  );

  const messagesResult = await collections.messages.updateMany(A2A_EVENTS_FILTER, {
    $unset: { a2a_events: "" },
    $set: { updated_at: input.now },
  });

  return {
    ...plan,
    applied_counts: {
      checkpoint_collections_dropped: droppedCollections,
      conversations_cleaned: conversationsResult.modifiedCount ?? 0,
      messages_cleaned: messagesResult.modifiedCount ?? 0,
      tuple_writes_applied: 0,
    },
    applied_at: input.now,
    applied_by: input.actor,
  };
}
