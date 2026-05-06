/**
 * Auth gate for Ship Loop user-facing API routes.
 *
 * Production posture (per contracts/http-api.md):
 *   401 if no session, 404 if feature disabled, 404 if user-level
 *   shipLoop preference is off, 404 if the caller cannot see the
 *   target repo via their GitHub OAuth token.
 *
 * Mock-testing escape hatch:
 *   When the operator sets `SHIP_LOOP_ALLOW_NO_AUTH=true` (typically
 *   in local dev to drive the mock-webhook flow without a NextAuth
 *   session), the GET endpoints skip auth and treat the caller as a
 *   "mock-tester" pseudo-user. This is **explicit opt-in** and
 *   refuses to activate when NODE_ENV=production. The flag never
 *   bypasses the server-side `SHIP_LOOP_ENABLED` toggle, never
 *   bypasses HMAC verification on the webhook receiver, and is
 *   ignored by HITL action routes (which always require a real
 *   GitHub identity to forward to GitHub).
 *
 * Routes call `requireShipLoopReader()` to get either
 *   - { kind: "session", user, session }, the real path, OR
 *   - { kind: "mock", user }, only when SHIP_LOOP_ALLOW_NO_AUTH=true.
 *
 * Returning a sentinel rather than throwing keeps route code linear.
 */

import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";

export interface ShipLoopReaderSession {
  kind: "session";
  user: { email: string; name: string };
}

export interface ShipLoopReaderMock {
  kind: "mock";
  user: { email: string; name: string };
}

export type ShipLoopReader = ShipLoopReaderSession | ShipLoopReaderMock;

const MOCK_USER = { email: "ship-loop-mock@local", name: "Ship Loop Mock" };

export function isShipLoopMockAuthAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.SHIP_LOOP_ALLOW_NO_AUTH === "true";
}

/**
 * Resolve the calling reader for a Ship Loop GET endpoint. Returns
 * `null` when the caller is unauthenticated AND no mock bypass is in
 * effect; the route should respond with 401 in that case.
 *
 * The function intentionally does not throw -- routes need to choose
 * 401 vs 404 (feature off) vs 404 (per-user flag off) based on more
 * than just session presence.
 */
export async function requireShipLoopReader(
  // request param kept for parity with future audience checks
  // and to make tests' intent obvious; currently unused.
  _req: NextRequest | Request,
): Promise<ShipLoopReader | null> {
  if (isShipLoopMockAuthAllowed()) {
    return { kind: "mock", user: MOCK_USER };
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return {
    kind: "session",
    user: {
      email: session.user.email,
      name: session.user.name ?? session.user.email,
    },
  };
}
