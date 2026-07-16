import type { Collection,Document } from "mongodb";

import { getRbacCollection } from "./mongo-collections";

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const USER_ID_PATTERN = /^[A-Za-z0-9._%+@-]+$/;

/**
 * The per-user agent-default fields. `dm_default_agent_id` routes direct
 * messages to the bot (Slack/Webex); `web_default_agent_id` is the agent the
 * Web UI opens new chats with, overriding the platform default. They are
 * independent so a user can prefer different agents per surface.
 */
export type UserAgentPreferenceField =
  | "dm_default_agent_id"
  | "web_default_agent_id";

export interface UserPreferenceDocument extends Document {
  tenant_id: string;
  user_id: string;
  dm_default_agent_id: string | null;
  web_default_agent_id?: string | null;
  updated_at: string;
}

export interface UserPreference {
  dm_default_agent_id: string | null;
  web_default_agent_id: string | null;
}

export interface UserPreferenceScope {
  tenantId: string;
  userId: string;
}

export interface SetUserPreferenceInput extends UserPreferenceScope {
  /** Agent identifier the user has chosen. */
  agentId: string;
  /** Which default to write. Defaults to the DM default for back-compat. */
  field?: UserAgentPreferenceField;
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

/**
 * Read the user's saved DM default agent. Returns `{ dm_default_agent_id: null }`
 * when the user has never saved a preference; the bot interprets that as
 * "fall through to deployment default" (see spec FR-023).
 */
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
    return { dm_default_agent_id: null, web_default_agent_id: null };
  }
  return {
    dm_default_agent_id: doc.dm_default_agent_id ?? null,
    web_default_agent_id: doc.web_default_agent_id ?? null,
  };
}

/**
 * Upsert the user's saved DM default agent.
 *
 * Callers are expected to have already verified that the user has `can_use`
 * on `agentId` via the BFF PDP. This function does NOT re-check authorization
 * — that's the route's responsibility, and the bot re-verifies again at
 * dispatch time per FR-024.
 */
export async function setUserPreference(input: SetUserPreferenceInput): Promise<void> {
  assertValidUserId(input.userId);
  assertValidAgentId(input.agentId);
  const field: UserAgentPreferenceField = input.field ?? "dm_default_agent_id";
  const collection = await getCollectionRef();
  const now = new Date().toISOString();
  await collection.updateOne(
    { tenant_id: input.tenantId, user_id: input.userId },
    {
      $set: {
        tenant_id: input.tenantId,
        user_id: input.userId,
        [field]: input.agentId,
        updated_at: now,
      },
    },
    { upsert: true },
  );
}

/**
 * Clear the user's saved DM default agent (`dm_default_agent_id := null`).
 *
 * Used by the Web UI "clear preference" button and by the in-DM `/use default`
 * command (spec FR-029a). We keep the document around (rather than deleting it)
 * so `updated_at` reflects intent — "the user actively chose deployment
 * default" is different from "the user has never set a preference".
 */
export async function clearUserPreference(
  scope: UserPreferenceScope,
  field: UserAgentPreferenceField = "dm_default_agent_id",
): Promise<void> {
  assertValidUserId(scope.userId);
  const collection = await getCollectionRef();
  const now = new Date().toISOString();
  await collection.updateOne(
    { tenant_id: scope.tenantId, user_id: scope.userId },
    {
      $set: {
        tenant_id: scope.tenantId,
        user_id: scope.userId,
        [field]: null,
        updated_at: now,
      },
    },
    { upsert: true },
  );
}
