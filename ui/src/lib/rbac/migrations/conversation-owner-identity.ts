import type { MigrationApplyResult,MigrationPlanResult } from "./types";

export const CONVERSATION_OWNER_IDENTITY_MIGRATION_ID = "conversation_owner_identity_v1";
export const CONVERSATION_OWNER_IDENTITY_CONFIRMATION = "MIGRATE conversations TO v2";

interface ConversationOwnerIdentityDoc {
  _id: string;
  owner_id?: string;
  owner_subject?: string | null;
  owner_identity_version?: number;
  metadata?: Record<string, unknown>;
}

interface UserIdentityDoc {
  email?: string;
  keycloak_sub?: string;
  metadata?: {
    keycloak_sub?: string;
  };
}

interface DeriveConversationOwnerIdentityPlanInput {
  conversations: ConversationOwnerIdentityDoc[];
  users: UserIdentityDoc[];
  now: string;
}

interface ApplyConversationOwnerIdentityMigrationInput extends DeriveConversationOwnerIdentityPlanInput {
  actor: string;
  conversationsCollection: {
    updateOne: (filter: Record<string, unknown>, update: Record<string, unknown>) => Promise<unknown>;
  };
}

function normalizeEmail(email: string | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

function subjectForUser(user: UserIdentityDoc): string | null {
  return user.keycloak_sub?.trim() || user.metadata?.keycloak_sub?.trim() || null;
}

function buildEmailSubjectIndex(users: UserIdentityDoc[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const user of users) {
    const email = normalizeEmail(user.email);
    const subject = subjectForUser(user);
    if (email && subject) index.set(email, subject);
  }
  return index;
}

function isNormalized(conversation: ConversationOwnerIdentityDoc): boolean {
  return Boolean(conversation.owner_subject?.trim());
}

export function deriveConversationOwnerIdentityPlan(
  input: DeriveConversationOwnerIdentityPlanInput,
): MigrationPlanResult {
  const subjectsByEmail = buildEmailSubjectIndex(input.users);
  const sampleDiffs: MigrationPlanResult["sample_diffs"] = [];
  let alreadyNormalized = 0;
  let resolvable = 0;
  let unresolved = 0;

  for (const conversation of input.conversations) {
    if (isNormalized(conversation)) {
      alreadyNormalized += 1;
      continue;
    }

    const ownerEmail = normalizeEmail(conversation.owner_id);
    const ownerSubject = subjectsByEmail.get(ownerEmail);
    if (!ownerEmail || !ownerSubject) {
      unresolved += 1;
      continue;
    }

    resolvable += 1;
    if (sampleDiffs.length < 10) {
      sampleDiffs.push({
        collection: "conversations",
        id: conversation._id,
        before: { owner_id: conversation.owner_id ?? null, owner_subject: conversation.owner_subject ?? null },
        after: {
          owner_id: conversation.owner_id ?? null,
          owner_subject: ownerSubject,
          owner_identity_version: 2,
        },
      });
    }
  }

  const warnings =
    unresolved > 0
      ? [`${unresolved} conversation owner email(s) could not be resolved to Keycloak subjects.`]
      : [];

  return {
    migration_id: CONVERSATION_OWNER_IDENTITY_MIGRATION_ID,
    release: "0.5.1",
    schema_area: "conversations",
    kind: "implicit",
    from_version: 1,
    to_version: 2,
    counts: {
      total_conversations: input.conversations.length,
      already_normalized: alreadyNormalized,
      resolvable,
      unresolved,
      tuple_writes_planned: 0,
    },
    warnings,
    sample_diffs: sampleDiffs,
    tuple_writes_planned: 0,
    confirmation: CONVERSATION_OWNER_IDENTITY_CONFIRMATION,
  };
}

export async function applyConversationOwnerIdentityMigration(
  input: ApplyConversationOwnerIdentityMigrationInput,
): Promise<MigrationApplyResult> {
  const plan = deriveConversationOwnerIdentityPlan(input);
  const subjectsByEmail = buildEmailSubjectIndex(input.users);
  let conversationsUpdated = 0;

  for (const conversation of input.conversations) {
    if (isNormalized(conversation)) continue;
    const ownerEmail = normalizeEmail(conversation.owner_id);
    const ownerSubject = subjectsByEmail.get(ownerEmail);
    if (!ownerSubject) continue;

    await input.conversationsCollection.updateOne(
      { _id: conversation._id, $or: [{ owner_subject: { $exists: false } }, { owner_subject: null }, { owner_subject: "" }] },
      {
        $set: {
          owner_subject: ownerSubject,
          owner_identity_version: 2,
          "metadata.owner_identity_migration": {
            migration_id: CONVERSATION_OWNER_IDENTITY_MIGRATION_ID,
            migrated_at: input.now,
            migrated_by: input.actor,
            source_field: "owner_id",
          },
        },
      },
    );
    conversationsUpdated += 1;
  }

  return {
    ...plan,
    applied_counts: {
      conversations_updated: conversationsUpdated,
      tuple_writes_applied: 0,
    },
    applied_at: input.now,
    applied_by: input.actor,
  };
}
