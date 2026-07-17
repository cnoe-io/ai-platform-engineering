/**
 * POST /api/skills/token
 *
 * Generate a local skills API token (HS256 JWT) for programmatic access.
 * Requires an active NextAuth session. The generated token is scoped to
 * `skills:read` and always gets `role: 'user'` (no admin escalation).
 * Registering the new key revokes any previously active key for this user
 * (see ui/src/lib/skills-api-keys.ts) — only one key is active at a time.
 *
 * Request body (optional):
 *   { "expires_in_days": 30 | 60 | 90 }   (default 90, max 90)
 *
 * Response:
 *   { "token": "ey...", "token_type": "Bearer", "expires_in": 7776000, "scope": "skills:read" }
 *
 * GET /api/skills/token
 *
 * Report whether the current user has an active key, without exposing it —
 * the raw JWT is only ever returned once, from POST.
 *
 * Response:
 *   { "has_active_key": false }
 *   { "has_active_key": true, "created_at": "...", "expires_at": "..." }
 */

import { randomUUID } from 'node:crypto';

import { handleApiError,withAuth } from '@/lib/api-middleware';
import { signLocalSkillsToken } from '@/lib/jwt-validation';
import { getActiveSkillsApiKey, registerSkillsApiKey } from '@/lib/skills-api-keys';
import { NextRequest,NextResponse } from 'next/server';

const MAX_DAYS = 90;

export async function GET(request: NextRequest) {
  try {
    return await withAuth(request, async (_req, user) => {
      const active = await getActiveSkillsApiKey(user.email);
      if (!active) {
        return NextResponse.json({ has_active_key: false });
      }
      return NextResponse.json({
        has_active_key: true,
        created_at: active.created_at,
        expires_at: active.expires_at,
      });
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return await withAuth(request, async (_req, user) => {
      let days = MAX_DAYS;

      try {
        const body = await request.json();
        if (body.expires_in_days !== undefined) {
          const requested = Number(body.expires_in_days);
          if (!Number.isInteger(requested) || requested < 1 || requested > MAX_DAYS) {
            return NextResponse.json(
              { error: `expires_in_days must be an integer between 1 and ${MAX_DAYS}` },
              { status: 400 },
            );
          }
          days = requested;
        }
      } catch {
        // Empty body or invalid JSON — use defaults
      }

      const jti = randomUUID();
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + days * 86400_000);
      const token = await signLocalSkillsToken(user.email, user.name, `${days}d`, jti);

      await registerSkillsApiKey({ userEmail: user.email, jti, createdAt, expiresAt });

      return NextResponse.json({
        token,
        token_type: 'Bearer',
        expires_in: days * 86400,
        scope: 'skills:read',
      });
    });
  } catch (error) {
    return handleApiError(error);
  }
}
