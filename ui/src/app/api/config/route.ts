import { NextResponse } from "next/server";

/**
 * Runtime Configuration API
 *
 * Serves all NEXT_PUBLIC_* environment variables from the server at RUNTIME.
 * Useful for debugging what the server actually sees, and as an async fallback.
 *
 * Auto-discovers all NEXT_PUBLIC_* variables -- no manual listing needed.
 * This is the same data that PublicEnvScript injects into window.__RUNTIME_ENV__.
 */
export async function GET() {
  // Server-side process.env is read at RUNTIME (not build time)
  // Auto-discover all NEXT_PUBLIC_* variables
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('NEXT_PUBLIC_') && value !== undefined) {
      config[key] = value;
    }
  }

  return NextResponse.json(config, {
    status: 200,
    headers: {
      // Cache for 60 seconds - config doesn't change often during container lifetime
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}
