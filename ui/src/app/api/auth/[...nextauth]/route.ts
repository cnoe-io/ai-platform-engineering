import NextAuth from "next-auth";
import { getAuthOptions } from "@/lib/auth-config";
import { NextRequest } from "next/server";

/**
 * Dynamic NextAuth handler — loads OIDC configuration from DB on each auth
 * request so that admin-configured OIDC settings take effect without restart.
 * A 30s in-memory cache in getAuthOptions() prevents per-request DB hits.
 */
async function handler(req: NextRequest, context: any) {
  const options = await getAuthOptions();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (NextAuth(options) as any)(req, context);
}

export { handler as GET, handler as POST };
