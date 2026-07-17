import type { Collection, Document } from 'mongodb';

import { getCollection } from '@/lib/mongodb';
import type { SkillsApiKey } from '@/types/mongodb';

const SKILLS_API_KEYS_COLLECTION = 'skills_api_keys';

function getSkillsApiKeysCollection(): Promise<Collection<SkillsApiKey & Document>> {
  return getCollection<SkillsApiKey & Document>(SKILLS_API_KEYS_COLLECTION);
}

/** Metadata for a user's current active key, or null if they have none. */
export async function getActiveSkillsApiKey(
  userEmail: string,
): Promise<Pick<SkillsApiKey, 'created_at' | 'expires_at' | 'label'> | null> {
  const collection = await getSkillsApiKeysCollection();
  const active = await collection.findOne(
    { user_email: userEmail, status: 'active' },
    { projection: { created_at: 1, expires_at: 1, label: 1 } },
  );
  if (!active) return null;
  return { created_at: active.created_at, expires_at: active.expires_at, label: active.label };
}

/**
 * Revoke any existing active key(s) for this user and register the newly
 * minted one as active. Revoking-then-inserting (rather than upserting) keeps
 * a full history of prior keys for audit.
 */
export async function registerSkillsApiKey(params: {
  userEmail: string;
  jti: string;
  createdAt: Date;
  expiresAt: Date;
  label?: string;
}): Promise<void> {
  const collection = await getSkillsApiKeysCollection();
  await collection.updateMany(
    { user_email: params.userEmail, status: 'active' },
    { $set: { status: 'revoked', revoked_at: params.createdAt } },
  );
  await collection.insertOne({
    user_email: params.userEmail,
    jti: params.jti,
    label: params.label,
    created_at: params.createdAt,
    expires_at: params.expiresAt,
    status: 'active',
  });
}

/** True if `jti` belongs to a key that is still active (not revoked). A `jti`
 *  with no matching document (e.g. a token minted before this registry
 *  existed) is treated as active — there's nothing to revoke it against. */
export async function isSkillsApiKeyActive(jti: string): Promise<boolean> {
  const collection = await getSkillsApiKeysCollection();
  const doc = await collection.findOne({ jti }, { projection: { status: 1 } });
  if (!doc) return true;
  return doc.status === 'active';
}
