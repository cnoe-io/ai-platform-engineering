/**
 * POST /api/admin/rotate-keys
 *
 * Re-wraps all envelope-encrypted DEKs with the current NEXTAUTH_SECRET.
 * Used after rotating the environment secret so existing encrypted data
 * (OIDC client secret, TOTP secrets, LLM keys, MCP headers) is brought
 * up to date.
 *
 * Optionally accepts old_master_secret if NEXTAUTH_SECRET was already
 * updated in the environment before this endpoint was called.
 *
 * Protected by admin-only access, rate limiting, and audit logging.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, withAuth, requireAdmin } from '@/lib/api-middleware';
import { getSecret, isMasterKeyFromEnv } from '@/lib/secret-manager';
import { rotateAllEncryptedData } from '@/lib/key-rotation';
import { writeAuditLog, getClientIp } from '@/lib/audit-log';
import { RateLimits } from '@/lib/rate-limit';

export const POST = withErrorHandler<any>(async (request: NextRequest) => {
  return withAuth(request, async (_req, user, session) => {
    requireAdmin(session);

    const ip = getClientIp(request);

    const rateLimit = RateLimits.keyRotation(ip);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many key rotation attempts. Please try again later.' },
        { status: 429 },
      );
    }

    let body: { old_master_secret?: string } = {};
    try {
      const raw = await request.text();
      if (raw) body = JSON.parse(raw);
    } catch { /* body is optional */ }

    const newSecret = getSecret();
    const oldSecret = body.old_master_secret?.trim() || undefined;

    if (oldSecret && oldSecret === newSecret) {
      return NextResponse.json(
        { error: 'old_master_secret must differ from the current NEXTAUTH_SECRET.' },
        { status: 400 },
      );
    }

    await writeAuditLog({
      actor_email: user.email,
      actor_ip: ip,
      action: 'keys.rotation_initiated',
      resource_type: 'key_rotation',
      resource_id: 'global',
      outcome: 'success',
      metadata: { using_explicit_old_secret: !!oldSecret },
    });

    try {
      const { count, errors } = await rotateAllEncryptedData(
        oldSecret ?? newSecret,
        newSecret,
      );

      await writeAuditLog({
        actor_email: user.email,
        actor_ip: ip,
        action: 'keys.rotation_completed',
        resource_type: 'key_rotation',
        resource_id: 'global',
        outcome: errors.length === 0 ? 'success' : 'failure',
        metadata: { count, errors },
      });

      return NextResponse.json({
        success: true,
        count,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      await writeAuditLog({
        actor_email: user.email,
        actor_ip: ip,
        action: 'keys.rotation_failed',
        resource_type: 'key_rotation',
        resource_id: 'global',
        outcome: 'failure',
        metadata: { error: 'internal_error' },
      });
      return NextResponse.json({ error: error.message || 'Rotation failed' }, { status: 400 });
    }
  });
});

/** GET — returns key status for the Key Management panel.
 *
 * source='database'    → master_key doc exists in MongoDB (not yet secured)
 * source='environment' → no master_key doc in MongoDB (key lives outside DB)
 *
 * The warning in the UI is tied to MongoDB key existence, not env var presence.
 * "Safe" = key is NOT in the database.
 */
export const GET = withErrorHandler<any>(async (request: NextRequest) => {
  return withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const key = process.env.NEXTAUTH_SECRET ?? '';
    // Fixed-width display: always 8 asterisks + last 4 chars.
    // Avoids leaking key length while still letting the admin identify the active key.
    const fingerprint = key.length >= 4 ? `••••••••${key.slice(-4)}` : null;

    // Check MongoDB directly — warning condition is DB key existence
    let keyInDatabase = false;
    try {
      const { isMongoDBConfigured, getCollection } = await import('@/lib/mongodb');
      if (isMongoDBConfigured) {
        const col = await getCollection<{ _id: string }>('platform_config');
        const doc = await col.findOne({ _id: 'master_key' as any }, { projection: { _id: 1 } });
        keyInDatabase = !!doc;
      }
    } catch { /* ignore */ }

    return NextResponse.json({
      success: true,
      source: keyInDatabase ? 'database' : 'environment',
      fingerprint,
    });
  });
});
