import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest, type AuthResult } from "@/lib/da-proxy";

/** Browser streams use the session; explicit API credentials retain bearer precedence. */
export async function authenticateChatStreamRequest(
  request: NextRequest,
): Promise<AuthResult | NextResponse> {
  const authorization = request.headers.get("authorization");
  // A malformed explicit credential must never fall back to an admin cookie.
  if (authorization !== null && !/^Bearer \S+$/.test(authorization)) {
    return NextResponse.json({ error: "A valid bearer token is required" }, { status: 401 });
  }
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;

  if (auth.authenticatedUser?.session.authMethod === "session") {
    const expectedOrigin = new URL(process.env.NEXTAUTH_URL || request.url).origin;
    if (request.headers.get("origin") !== expectedOrigin ||
        request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json(
        { error: "Same-origin requests are required for session authentication" },
        { status: 403 },
      );
    }
  }
  return auth;
}
