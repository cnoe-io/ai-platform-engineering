import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getServerConfig } from "@/lib/config";

/**
 * Runtime Configuration API (unauthenticated)
 *
 * Serves the full application Config from server-side environment variables.
 * The client's ConfigProvider fetches this once on app load to hydrate the
 * React ConfigContext.  Health-check / config data is not sensitive.
 *
 * Uses headers() to force dynamic rendering (no static caching at build time).
 */
export async function GET() {
  // Force dynamic rendering so process.env is read at request time
  await headers();

  const config = getServerConfig();

  return NextResponse.json(config, {
    status: 200,
    headers: {
      // Cache for 60 seconds — config doesn't change during container lifetime
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}
