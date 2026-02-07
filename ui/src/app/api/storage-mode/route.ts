import { NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";

/**
 * Server source of truth for storage mode (unauthenticated).
 *
 * Returns whether the server is using MongoDB or localStorage-only.
 * Kept for backward compatibility — the full config is now available
 * via GET /api/config (storageMode field).
 */
export async function GET() {
  const { storageMode } = getServerConfig();

  return NextResponse.json(
    { mode: storageMode },
    {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    }
  );
}
