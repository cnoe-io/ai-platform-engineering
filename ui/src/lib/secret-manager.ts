/**
 * Secret Manager — master encryption key lifecycle
 *
 * States and transitions:
 *
 *   1. ZERO-CONFIG (no NEXTAUTH_SECRET in env):
 *      - Auto-generate a key and store it in MongoDB platform_config.master_key
 *      - Key source: 'database' → UI shows red "not secure for production" warning
 *      - App is fully functional; encrypted data survives restarts (DB persists key)
 *
 *   2. TRANSITION (user sets NEXTAUTH_SECRET in env, restarts):
 *      - Env key detected, differs from stored DB key
 *      - All encrypted data auto-rotated from old DB key → new env key
 *      - MongoDB entry DELETED (key no longer lives in DB)
 *      - Key source: 'environment' → UI shows green, warning gone
 *
 *   3. PRODUCTION (NEXTAUTH_SECRET set, no DB entry):
 *      - Key sourced purely from environment
 *      - Key source: 'environment' → green, no warning
 *
 * Shortcut paths:
 *   - Set NEXTAUTH_SECRET before first run → skip zero-config entirely
 *   - k8s: set in Secret, deploy → always starts in state 3
 */

import crypto from 'crypto';

export function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('[CAIPE] NEXTAUTH_SECRET is not initialized.');
  return secret;
}

export function isMasterKeyFromEnv(): boolean {
  return process.env._CAIPE_KEY_SOURCE === 'env';
}

export async function initializeMasterSecret(): Promise<void> {
  const envSecret = process.env.NEXTAUTH_SECRET?.trim() || undefined;

  // Lazy import to avoid circular dependencies at module load time
  const { isMongoDBConfigured, getCollection } = await import('@/lib/mongodb');

  if (!isMongoDBConfigured) {
    // No MongoDB — env key is required; fall back to ephemeral for dev
    if (envSecret) {
      process.env._CAIPE_KEY_SOURCE = 'env';
    } else {
      process.env.NEXTAUTH_SECRET = crypto.randomBytes(32).toString('base64');
      process.env._CAIPE_KEY_SOURCE = 'ephemeral';
      console.warn('[CAIPE] No MongoDB and no NEXTAUTH_SECRET — ephemeral key in use');
    }
    return;
  }

  const col = await getCollection<{ _id: string; value: string; source: string }>('platform_config');

  if (envSecret) {
    // ── Env key present ─────────────────────────────────────────────────
    process.env._CAIPE_KEY_SOURCE = 'env';

    const stored = await col.findOne({ _id: 'master_key' as any });
    if (stored?.value && stored.value !== envSecret) {
      // Key changed — rotate all encrypted data before accepting the new key.
      // Two-phase commit: only delete the old DB key if ALL secrets re-wrapped
      // successfully. If anything fails, revert to the old key so users can
      // still authenticate (TOTP, OIDC etc. remain readable).
      console.log('[CAIPE] NEXTAUTH_SECRET changed — rotating encrypted data...');
      try {
        const { rotateAllEncryptedData } = await import('@/lib/key-rotation');
        const { count, errors } = await rotateAllEncryptedData(stored.value, envSecret);

        if (errors.length > 0) {
          // Rotation incomplete — revert to old key so nothing is broken
          console.error('[CAIPE] Rotation failed — reverting to previous key:', errors);
          process.env.NEXTAUTH_SECRET = stored.value;
          process.env._CAIPE_KEY_SOURCE = 'database';
          console.error('[CAIPE] Still using DB key. Fix the errors above, then restart again.');
          return;
        }

        console.log(`[CAIPE] Rotation complete — ${count} secret(s) re-wrapped`);
      } catch (e) {
        // Unexpected failure — revert
        console.error('[CAIPE] Rotation threw unexpectedly — reverting to previous key:', e);
        process.env.NEXTAUTH_SECRET = stored.value;
        process.env._CAIPE_KEY_SOURCE = 'database';
        return;
      }
    }

    // All secrets rotated (or no old key existed) — safe to remove DB entry
    if (stored) {
      await col.deleteOne({ _id: 'master_key' as any });
      console.log('[CAIPE] Master key removed from database (now environment-managed)');
    }
    return;
  }

  // ── No env key — load or generate a DB-stored key ────────────────────
  const stored = await col.findOne({ _id: 'master_key' as any });
  if (stored?.value) {
    process.env.NEXTAUTH_SECRET = stored.value;
    process.env._CAIPE_KEY_SOURCE = 'database';
    console.log('[CAIPE] Using master key from MongoDB (set NEXTAUTH_SECRET to secure it)');
    return;
  }

  // First run — generate and persist
  const newKey = crypto.randomBytes(32).toString('base64');
  await col.insertOne({
    _id: 'master_key' as any,
    value: newKey,
    source: 'generated',
    created_at: new Date(),
  } as any);
  process.env.NEXTAUTH_SECRET = newKey;
  process.env._CAIPE_KEY_SOURCE = 'database';
  console.log('[CAIPE] Generated master key — stored in MongoDB');
  console.log('[CAIPE] Run: openssl rand -base64 32 → set as NEXTAUTH_SECRET → restart');
}
