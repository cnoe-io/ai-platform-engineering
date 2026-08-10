/**
 * Mint a NextAuth JWT session token for load-testing.
 *
 * Usage (from repo root):
 *   NEXTAUTH_SECRET=<secret> node scripts/mint-test-session.mjs
 *
 * Prints the raw cookie value to stdout. The Locust benchmark reads this
 * via subprocess and injects it as `next-auth.session-token` on every request.
 */

import { encode } from "next-auth/jwt";

const secret = process.env.NEXTAUTH_SECRET;
if (!secret) {
  process.stderr.write("ERROR: NEXTAUTH_SECRET env var is required\n");
  process.exit(1);
}

const expiresAt = Math.floor(Date.now() / 1000) + 7200; // 2h — outlasts any benchmark run

const token = await encode({
  secret,
  maxAge: 7200,
  token: {
    sub: "locust-benchmark-user",
    name: "Locust Benchmark",
    email: process.env.LOCUST_USER_EMAIL ?? "locust@benchmark.local",
    accessToken: "locust-benchmark-access-token",
    expiresAt,
    isAuthorized: true,
    role: "admin",
    canViewAdmin: true,
    canAccessDynamicAgents: true,
    org: process.env.CAIPE_ORG_KEY?.trim() || "caipe",
  },
});

process.stdout.write(token + "\n");
