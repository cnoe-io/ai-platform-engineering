import { NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";

/**
 * GET /api/agents/tools
 *
 * Proxies to the supervisor's /tools endpoint to return the dynamically
 * discovered tool names grouped by subagent.  The supervisor builds this
 * mapping from the actual MCP tools loaded at startup.
 *
 * No auth required — agent/tool names are not sensitive.
 */
export async function GET() {
  const { caipeUrl } = getServerConfig();
  const baseUrl = caipeUrl.replace(/\/$/, "");

  try {
    const res = await fetch(`${baseUrl}/tools`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `Supervisor returned ${res.status}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    return NextResponse.json({ success: true, data: { tools: data.tools ?? {} } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Supervisor unreachable";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 502 },
    );
  }
}
