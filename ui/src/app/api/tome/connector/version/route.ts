import { NextRequest, NextResponse } from "next/server";

import { getAuthFromBearerOrSession } from "@/lib/api-middleware";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { requireInteractiveTomePrincipal } from "@/lib/tome/principal";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, X-Caipe-Token",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isTomeServerEnabled()) return new NextResponse("Not found", { status: 404 });

  try {
    const { session } = await getAuthFromBearerOrSession(request);
    requireInteractiveTomePrincipal(session);
  } catch {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  return NextResponse.json(
    { service: "tome", version: "0.1.0", status: "ok" },
    { headers: CORS_HEADERS },
  );
}
