/**
 * GET  /api/admin/oidc-config  — read current OIDC configuration (admin only)
 * PUT  /api/admin/oidc-config  — save/update OIDC configuration (admin only)
 * POST /api/admin/oidc-config/test — test OIDC connection (admin only)
 *
 * The client_secret is stored envelope-encrypted and never returned in plaintext.
 * GET responses mask the client_secret as "••••••••".
 *
 * Env-var OIDC config (OIDC_ISSUER etc.) takes precedence over DB config for
 * backward compatibility. When env vars are present, this endpoint is read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, withAuth, requireAdmin } from '@/lib/api-middleware';
import { getCollection } from '@/lib/mongodb';
import { encryptSecret, MASKED_SECRET } from '@/lib/crypto';
import { writeAuditLog, getClientIp } from '@/lib/audit-log';
import { invalidateOidcCache } from '@/lib/auth-config';
import type { OidcConfig } from '@/types/mongodb';

// Indicators for which OIDC knobs are being overridden by environment variables.
// Env values win over DB values inside auth-config.ts, so the UI must surface
// this to the admin or saves will silently not take effect.
const ENV_OIDC_CONFIGURED =
  !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET);

const envLockedFields = {
  issuer: process.env.OIDC_ISSUER !== undefined,
  clientId: process.env.OIDC_CLIENT_ID !== undefined,
  clientSecret: process.env.OIDC_CLIENT_SECRET !== undefined,
  groupClaim: process.env.OIDC_GROUP_CLAIM !== undefined,
  requiredGroup: process.env.OIDC_REQUIRED_GROUP !== undefined,
  adminGroup: process.env.OIDC_REQUIRED_ADMIN_GROUP !== undefined,
  adminViewGroup: process.env.OIDC_REQUIRED_ADMIN_VIEW_GROUP !== undefined,
};

export const GET = withErrorHandler<any>(async (request: NextRequest) => {
  return withAuth(request, async (_req, user, session) => {
    requireAdmin(session);

    const ip = getClientIp(request);
    await writeAuditLog({
      actor_email: user.email,
      actor_ip: ip,
      action: 'oidc.config_read',
      resource_type: 'oidc_config',
      resource_id: 'oidc_config',
      outcome: 'success',
      metadata: { source: ENV_OIDC_CONFIGURED ? 'env' : 'db' },
    });

    if (ENV_OIDC_CONFIGURED) {
      return NextResponse.json({
        source: 'env',
        readonly: true,
        envLockedFields,
        issuer: process.env.OIDC_ISSUER,
        clientId: process.env.OIDC_CLIENT_ID,
        clientSecret: MASKED_SECRET,
        groupClaim: process.env.OIDC_GROUP_CLAIM ?? '',
        requiredGroup: process.env.OIDC_REQUIRED_GROUP ?? '',
        adminGroup: process.env.OIDC_REQUIRED_ADMIN_GROUP ?? '',
        adminViewGroup: process.env.OIDC_REQUIRED_ADMIN_VIEW_GROUP ?? '',
        enabled: true,
      });
    }

    const collection = await getCollection<OidcConfig>('platform_config');
    const doc = await collection.findOne({ _id: 'oidc_config' as any });

    if (!doc) {
      return NextResponse.json({ source: 'db', enabled: false, envLockedFields });
    }

    // Env vars for group claims can partially override DB values even when
    // OIDC core (issuer/clientId/clientSecret) is DB-configured. Surface which
    // individual fields are env-locked so the form can mark each one.
    return NextResponse.json({
      source: 'db',
      readonly: false,
      envLockedFields,
      issuer: doc.issuer,
      clientId: doc.clientId,
      clientSecret: MASKED_SECRET,
      groupClaim: envLockedFields.groupClaim ? (process.env.OIDC_GROUP_CLAIM ?? '') : doc.groupClaim,
      requiredGroup: envLockedFields.requiredGroup ? (process.env.OIDC_REQUIRED_GROUP ?? '') : doc.requiredGroup,
      adminGroup: envLockedFields.adminGroup ? (process.env.OIDC_REQUIRED_ADMIN_GROUP ?? '') : doc.adminGroup,
      adminViewGroup: envLockedFields.adminViewGroup ? (process.env.OIDC_REQUIRED_ADMIN_VIEW_GROUP ?? '') : doc.adminViewGroup,
      enabled: doc.enabled,
      updated_at: doc.updated_at,
      updated_by: doc.updated_by,
    });
  });
});

export const PUT = withErrorHandler<any>(async (request: NextRequest) => {
  return withAuth(request, async (_req, user, session) => {
    requireAdmin(session);

    if (ENV_OIDC_CONFIGURED) {
      return NextResponse.json(
        { error: 'OIDC is configured via environment variables and cannot be modified here.' },
        { status: 403 },
      );
    }

    let body: {
      issuer?: string;
      clientId?: string;
      clientSecret?: string;
      groupClaim?: string;
      requiredGroup?: string;
      adminGroup?: string;
      adminViewGroup?: string;
      enabled?: boolean;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const { issuer, clientId, clientSecret, groupClaim, requiredGroup, adminGroup, adminViewGroup, enabled } = body;

    if (!issuer || !clientId) {
      return NextResponse.json({ error: 'issuer and clientId are required.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const collection = await getCollection<OidcConfig>('platform_config');
    const existing = await collection.findOne({ _id: 'oidc_config' as any });

    // Only re-encrypt the client secret if a new one was provided
    // (client sends "••••••••" when keeping the existing secret)
    let encryptedClientSecret = existing?.clientSecret;
    if (clientSecret && clientSecret !== MASKED_SECRET) {
      encryptedClientSecret = encryptSecret(clientSecret);
    }

    if (!encryptedClientSecret) {
      return NextResponse.json({ error: 'clientSecret is required for initial OIDC setup.' }, { status: 400 });
    }

    // IaC trumps UI per-field: if an OIDC_* env var is set for a group-claim
    // knob, preserve whatever was in the DB (or empty) instead of accepting
    // the submitted value. Runtime (`resolveOidcGroupConfig`) reads the env
    // var anyway, so persisting a UI value here would be silently ineffective
    // and just confuses the next admin who reads the DB doc.
    const doc: OidcConfig = {
      _id: 'oidc_config',
      issuer: issuer.trim(),
      clientId: clientId.trim(),
      clientSecret: encryptedClientSecret,
      groupClaim: envLockedFields.groupClaim
        ? (existing?.groupClaim ?? '')
        : (groupClaim?.trim() ?? ''),
      requiredGroup: envLockedFields.requiredGroup
        ? (existing?.requiredGroup ?? '')
        : (requiredGroup?.trim() ?? ''),
      adminGroup: envLockedFields.adminGroup
        ? (existing?.adminGroup ?? '')
        : (adminGroup?.trim() ?? ''),
      adminViewGroup: envLockedFields.adminViewGroup
        ? (existing?.adminViewGroup ?? '')
        : (adminViewGroup?.trim() ?? ''),
      enabled: enabled ?? true,
      key_version: encryptedClientSecret.key_version,
      updated_at: new Date(),
      updated_by: user.email,
    };

    await collection.replaceOne({ _id: 'oidc_config' as any }, doc as any, { upsert: true });

    // Critical: evict the in-memory OIDC provider cache used by getAuthOptions()
    // so the next /api/auth/* request rebuilds the provider with the new config.
    // Without this the save appears to succeed but the auth flow keeps using
    // the previous settings for up to OIDC_CACHE_TTL (30s) — and longer if
    // traffic keeps refreshing the cache before it actually expires.
    invalidateOidcCache();

    await writeAuditLog({
      actor_email: user.email,
      actor_ip: ip,
      action: 'oidc.config_written',
      resource_type: 'oidc_config',
      resource_id: 'oidc_config',
      outcome: 'success',
      metadata: { issuer, clientId, enabled },
    });

    return NextResponse.json({ success: true });
  });
});
