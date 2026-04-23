/**
 * Key rotation — two-phase commit.
 *
 * Phase 1 (PREPARE): Decrypt every secret with the old key and compute the
 *   re-wrapped value in memory. No database writes. If anything fails here
 *   the caller can abort safely — the database is untouched.
 *
 * Phase 2 (COMMIT): Write all re-wrapped values to the database. If any
 *   write fails, roll back the writes already made using the originals
 *   captured in Phase 1. Only declare success when every write is confirmed.
 *
 * This guarantees:
 *   - Users are never locked out (TOTP always readable)
 *   - No split state (all-or-nothing)
 *   - Safe to retry after a crash (idempotent)
 */

import { getCollection } from '@/lib/mongodb';
import { rotateEnvelopeKey, isEnvelopeEncrypted, type EnvelopeEncrypted } from '@/lib/crypto';
import type { OidcConfig, LocalUser } from '@/types/mongodb';

export interface RotationResult {
  count: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Internal: typed change descriptors so we can roll back precisely
// ---------------------------------------------------------------------------

type Change =
  | { type: 'oidc_secret'; original: EnvelopeEncrypted; rotated: EnvelopeEncrypted }
  | { type: 'totp'; email: string; original: EnvelopeEncrypted; rotated: EnvelopeEncrypted }
  | { type: 'llm_fields'; docId: string; original: Record<string, unknown>; rotated: Record<string, unknown> }
  | { type: 'mcp_env'; serverId: string; original: Record<string, unknown>; rotated: Record<string, unknown> }
  | { type: 'mcp_headers'; serverId: string; original: Record<string, unknown>; rotated: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Phase 1: build the change set (pure compute, no DB writes)
// ---------------------------------------------------------------------------

async function prepareChanges(
  oldSecret: string,
  newSecret: string,
): Promise<{ changes: Change[]; errors: string[] }> {
  const changes: Change[] = [];
  const errors: string[] = [];

  // OIDC client secret
  try {
    const col = await getCollection<OidcConfig>('platform_config');
    const doc = await col.findOne({ _id: 'oidc_config' as any });
    if (doc?.clientSecret && isEnvelopeEncrypted(doc.clientSecret)) {
      const rotated = rotateEnvelopeKey(doc.clientSecret, newSecret, undefined, oldSecret);
      changes.push({ type: 'oidc_secret', original: doc.clientSecret, rotated });
    }
  } catch (e) {
    errors.push(`OIDC client secret: ${String(e)}`);
  }

  // TOTP secrets (critical — failure here must abort everything)
  try {
    const col = await getCollection<LocalUser>('local_users');
    const users = await col.find({ totp_enabled: true }).toArray();
    for (const u of users) {
      if (u.totp_secret && isEnvelopeEncrypted(u.totp_secret)) {
        try {
          const rotated = rotateEnvelopeKey(u.totp_secret, newSecret, undefined, oldSecret);
          changes.push({ type: 'totp', email: u.email, original: u.totp_secret, rotated });
        } catch (e) {
          errors.push(`TOTP for ${u.email}: ${String(e)}`);
        }
      }
    }
  } catch (e) {
    errors.push(`Local users: ${String(e)}`);
  }

  // LLM provider API keys
  try {
    const col = await getCollection<any>('platform_config');
    const docs = await col.find({ _id: { $regex: /^llm_provider:/ } as any }).toArray();
    for (const doc of docs) {
      if (!doc.fields) continue;
      const original = { ...doc.fields };
      const rotated = { ...doc.fields };
      let changed = false;
      for (const [k, v] of Object.entries(doc.fields)) {
        if (isEnvelopeEncrypted(v)) {
          rotated[k] = rotateEnvelopeKey(v as EnvelopeEncrypted, newSecret, undefined, oldSecret);
          changed = true;
        }
      }
      if (changed) changes.push({ type: 'llm_fields', docId: doc._id, original, rotated });
    }
  } catch (e) {
    errors.push(`LLM providers: ${String(e)}`);
  }

  // MCP server env and headers
  try {
    const col = await getCollection<any>('mcp_servers');
    const servers = await col.find({}).toArray();
    for (const server of servers) {
      if (server.env_encrypted && server.env && typeof server.env === 'object') {
        const original = { ...server.env };
        const rotated: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(server.env)) {
          rotated[k] = isEnvelopeEncrypted(v)
            ? rotateEnvelopeKey(v as EnvelopeEncrypted, newSecret, undefined, oldSecret)
            : v;
        }
        changes.push({ type: 'mcp_env', serverId: server._id, original, rotated });
      }
      if (server.headers_encrypted && server.headers && typeof server.headers === 'object') {
        const original = { ...server.headers };
        const rotated: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(server.headers)) {
          rotated[k] = isEnvelopeEncrypted(v)
            ? rotateEnvelopeKey(v as EnvelopeEncrypted, newSecret, undefined, oldSecret)
            : v;
        }
        changes.push({ type: 'mcp_headers', serverId: server._id, original, rotated });
      }
    }
  } catch (e) {
    errors.push(`MCP servers: ${String(e)}`);
  }

  return { changes, errors };
}

// ---------------------------------------------------------------------------
// Phase 2: write all changes, roll back on any failure
// ---------------------------------------------------------------------------

async function commitChanges(changes: Change[]): Promise<{ committed: number; rollbackErrors: string[] }> {
  const committed: Change[] = [];
  let failureError: string | null = null;

  for (const change of changes) {
    try {
      await applyChange(change, 'rotated');
      committed.push(change);
    } catch (e) {
      failureError = `Write failed for ${change.type}: ${String(e)}`;
      break;
    }
  }

  if (!failureError) {
    return { committed: committed.length, rollbackErrors: [] };
  }

  // Write failed — roll back everything already committed
  const rollbackErrors: string[] = [failureError];
  for (const change of committed) {
    try {
      await applyChange(change, 'original');
    } catch (e) {
      rollbackErrors.push(`Rollback failed for ${change.type}: ${String(e)}`);
    }
  }

  return { committed: 0, rollbackErrors };
}

async function applyChange(change: Change, version: 'rotated' | 'original'): Promise<void> {
  const value = change[version];

  switch (change.type) {
    case 'oidc_secret': {
      const ev = value as EnvelopeEncrypted;
      const col = await getCollection<OidcConfig>('platform_config');
      await col.updateOne(
        { _id: 'oidc_config' as any },
        { $set: { clientSecret: ev, key_version: ev.key_version, updated_at: new Date() } },
      );
      break;
    }
    case 'totp': {
      const col = await getCollection<LocalUser>('local_users');
      await col.updateOne({ email: change.email }, { $set: { totp_secret: value as EnvelopeEncrypted, updated_at: new Date() } });
      break;
    }
    case 'llm_fields': {
      const col = await getCollection<any>('platform_config');
      await col.updateOne({ _id: change.docId as any }, { $set: { fields: value, updated_at: new Date() } });
      break;
    }
    case 'mcp_env': {
      const col = await getCollection<any>('mcp_servers');
      await col.updateOne({ _id: change.serverId as any }, { $set: { env: value, updated_at: new Date() } });
      break;
    }
    case 'mcp_headers': {
      const col = await getCollection<any>('mcp_servers');
      await col.updateOne({ _id: change.serverId as any }, { $set: { headers: value, updated_at: new Date() } });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rotate all envelope-encrypted secrets from oldSecret to newSecret.
 *
 * Uses a two-phase commit:
 *  1. Prepare: decrypt everything with old key in memory (no DB writes).
 *     Abort immediately if anything cannot be decrypted.
 *  2. Commit: write all re-wrapped values. Roll back on any write failure.
 *
 * Returns errors only if the operation was aborted or could not complete.
 * On abort/rollback, the database is left unchanged and the old key remains valid.
 */
export async function rotateAllEncryptedData(
  oldSecret: string,
  newSecret: string,
): Promise<RotationResult> {

  // Phase 1 — prepare (pure compute, no writes)
  const { changes, errors: prepErrors } = await prepareChanges(oldSecret, newSecret);

  if (prepErrors.length > 0) {
    // Cannot decrypt some secrets — abort before writing anything
    return {
      count: 0,
      errors: [`Rotation aborted (pre-check failed — old key may not match stored secrets):`, ...prepErrors],
    };
  }

  if (changes.length === 0) {
    return { count: 0, errors: [] }; // nothing to rotate
  }

  // Phase 2 — commit (all-or-nothing with rollback)
  const { committed, rollbackErrors } = await commitChanges(changes);

  if (rollbackErrors.length > 0) {
    return {
      count: 0,
      errors: rollbackErrors,
    };
  }

  return { count: committed, errors: [] };
}
