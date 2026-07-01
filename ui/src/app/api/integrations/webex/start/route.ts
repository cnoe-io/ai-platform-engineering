import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/api/credentials/oauth/webex/connect", request.url), 302);
}
