import type { Collection,Document } from "mongodb";

import { getRbacCollection } from "./mongo-collections";

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const USER_ID_PATTERN = /^[A-Za-z0-9._%+@-]+$/;

/** Per-surface default agents. A null value means "use platform default". */
export type UserAgentPreferenceField =
  | "web_default_agent_id"
  | "slack_default_agent_id"
  | "webex_default_agent_id";

export interface UserPreferenceDocument extends Document {
  tenant_id: string;
  user_id: string;
  web_default_agent_id?: string | null;
  slack_default_agent_id?: string | null;
  webex_default_agent_id?: string | null;
  updated_at: string;
}

export interface UserPreference {
  web_default_agent_id: string | null;
  slack_default_agent_id: string | null;
  webex_default_agent_id: string | null;
}

export interface UserPreferenceScope {
  tenantId: string;
  userId: string;
}

export interface UpdateUserPreferencesInput extends UserPreferenceScope {
  preferences: Partial<Record<UserAgentPreferenceField,string | null>>;
}

function assertValidUserId(userId: string): void {
  if (!userId || userId.length === 0 || !USER_ID_PATTERN.test(userId)) {
    throw new Error("userPreferences: userId must be a non-empty stable identifier");
  }
}

function assertValidAgentId(agentId: string): void {
  if (!agentId || agentId.length === 0 || !OPENFGA_ID_PATTERN.test(agentId)) {
    throw new Error("userPreferences: agentId must be a non-empty OpenFGA-safe identifier");
  }
}

async function getCollectionRef(): Promise<Collection<UserPreferenceDocument>> {
  return getRbacCollection<UserPreferenceDocument>("userPreferences");
}

/** Read all surface defaults. Null values use the platform default. */
export async function getUserPreference(
  scope: UserPreferenceScope,
): Promise<UserPreference> {
  assertValidUserId(scope.userId);
  const collection = await getCollectionRef();
  const doc = await collection.findOne({
    tenant_id: scope.tenantId,
    user_id: scope.userId,
  });
  if (!doc) {
    return {
      web_default_agent_id: null,
      slack_default_agent_id: null,
      webex_default_agent_id: null,
    };
  }
  return {
    web_default_agent_id: doc.web_default_agent_id ?? null,
    slack_default_agent_id: doc.slack_default_agent_id ?? null,
    webex_default_agent_id: doc.webex_default_agent_id ?? null,
  };
}

/** Atomically update one or more surface defaults in the user's document. */
export async function updateUserPreferences(
  input: UpdateUserPreferencesInput,
): Promise<void> {
  assertValidUserId(input.userId);
  const entries = Object.entries(input.preferences) as Array<
    [UserAgentPreferenceField,string | null]
  >;
  if (entries.length === 0) {
    throw new Error("userPreferences: at least one preference is required");
  }
  for (const [, agentId] of entries) {
    if (agentId !== null) assertValidAgentId(agentId);
  }

  const collection = await getCollectionRef();
  const now = new Date().toISOString();
  await collection.updateOne(
    { tenant_id: input.tenantId, user_id: input.userId },
    {
      $set: {
        tenant_id: input.tenantId,
        user_id: input.userId,
        ...input.preferences,
        updated_at: now,
      },
    },
    { upsert: true },
  );
}
