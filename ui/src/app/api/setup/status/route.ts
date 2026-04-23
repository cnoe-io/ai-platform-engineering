/**
 * GET /api/setup/status
 *
 * Returns the current setup state of the application.
 * Used by auth-guard to decide whether to redirect to /setup.
 *
 * This endpoint is intentionally unauthenticated — it only reveals
 * whether setup is needed, not any sensitive information.
 *
 * States:
 *   no_admin       — no local admin exists; redirect to /setup
 *   local_only     — local admin exists but OIDC not configured
 *   oidc_configured — OIDC is configured and enabled
 */

import { NextResponse } from 'next/server';
import { localAdminExists } from '@/lib/local-auth';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import type { OidcConfig } from '@/types/mongodb';

export type SetupState = 'no_admin' | 'local_only' | 'oidc_configured';

export interface SetupStatusResponse {
  state: SetupState;
  /** Whether SSO is currently active (env-var or DB-backed OIDC enabled) */
  ssoEnabled: boolean;
}

/** Resolve effective SSO enabled state from env vars + DB */
async function resolveSsoEnabled(): Promise<boolean> {
  // Explicit env-var override
  if (process.env.SSO_ENABLED === 'true' || process.env.NEXT_PUBLIC_SSO_ENABLED === 'true') return true;

  // Env-var OIDC fully configured
  if (process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET) return true;

  // DB-backed OIDC
  try {
    const platformConfig = await getCollection<OidcConfig>('platform_config');
    const oidcDoc = await platformConfig.findOne({ _id: 'oidc_config' as any });
    return oidcDoc?.enabled === true;
  } catch {
    return false;
  }
}

export async function GET() {
  // If MongoDB is not configured, treat as unconfigured (will show setup page)
  if (!isMongoDBConfigured) {
    const ssoEnabled = await resolveSsoEnabled();
    return NextResponse.json({ state: 'no_admin' as SetupState, ssoEnabled });
  }

  try {
    const hasAdmin = await localAdminExists();
    const ssoEnabled = await resolveSsoEnabled();

    if (!hasAdmin) {
      if (ssoEnabled) {
        // Legacy env-var OIDC or DB OIDC without local admin — let them in
        return NextResponse.json({ state: 'oidc_configured' as SetupState, ssoEnabled });
      }
      return NextResponse.json({ state: 'no_admin' as SetupState, ssoEnabled });
    }

    if (ssoEnabled) {
      return NextResponse.json({ state: 'oidc_configured' as SetupState, ssoEnabled });
    }

    return NextResponse.json({ state: 'local_only' as SetupState, ssoEnabled });
  } catch (error) {
    console.error('[Setup Status] Error:', error);
    return NextResponse.json({ state: 'no_admin' as SetupState, ssoEnabled: false });
  }
}
